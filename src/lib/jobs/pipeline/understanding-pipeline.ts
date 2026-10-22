import { randomUUID } from 'node:crypto';

import { ContentType, JobType, UnderstandStatus } from '@prisma/client';

import { getAsrStatus } from '@/lib/ai/asr';
import { getInferenceGateway } from '@/lib/ai/gateway';
import { recordJobErrorReason, updateJobStage } from '@/lib/jobs/async-job';
import { taskLogger } from '@/lib/jobs/task-logger';
import { dispatchPendingJob } from '@/lib/jobs/dispatch';
import { recordCounter } from '@/lib/observability/metrics';
import { prisma } from '@/lib/prisma';
import { QueueName, type JobContext, type JobPayload } from '@/lib/queue';

/**
 * 端云协同结构化理解流水线（tasks.md §6.2）
 * ------------------------------------------------------------
 * 阶段状态机：`light-filter → deep-extract → product-gen → completed/failed`
 *   - light-filter：阶段 A 端侧轻量筛选（推理/ASR，见 §6.3）
 *   - deep-extract：阶段 B 云端知识抽取（大模型，见 §6.4）
 *   - product-gen：闪卡/笔记/图谱产物生成（见 §6.4）
 *
 * 阶段处理器通过 `registerPipelineStage` 注册（§6.3/§6.4 落地），未注册则失败。
 * 降级策略：
 *   - MindSpore 推理不可达 → 继续（InferenceGateway 内部已降级为均匀抽帧/unknown/空文本）；
 *   - 视频 ASR 配置或运行时不可用 → 轻筛选后失败，禁止误报语义产物完成。
 * 每次运行注册/更新 AsyncJob 阶段与 traceId。
 */

export type UnderstandPhase = 'light-filter' | 'deep-extract' | 'product-gen' | 'completed' | 'failed';

export type PipelineDegradation = { infer: boolean; asr: boolean; asrReason?: string };

export type PipelineStageContext = {
  contentId: string;
  traceId: string;
  degraded: PipelineDegradation;
};

export type PipelineStageHandler = (context: PipelineStageContext) => Promise<void>;

type RunnablePhase = Exclude<UnderstandPhase, 'completed' | 'failed'>;

const RUNNABLE_PHASES: RunnablePhase[] = ['light-filter', 'deep-extract', 'product-gen'];

// ---------------------------------------------------------------------------
// 阶段注册表（§6.3 / §6.4 落地）
// ---------------------------------------------------------------------------

const globalForStages = globalThis as unknown as {
  __slpPipelineStages?: Map<RunnablePhase, PipelineStageHandler>;
};

function stageRegistry(): Map<RunnablePhase, PipelineStageHandler> {
  if (!globalForStages.__slpPipelineStages) {
    globalForStages.__slpPipelineStages = new Map();
  }
  return globalForStages.__slpPipelineStages;
}

export function registerPipelineStage(phase: RunnablePhase, handler: PipelineStageHandler): void {
  stageRegistry().set(phase, handler);
}

/** 测试辅助：清空阶段注册表 */
export function __resetPipelineStagesForTest(): void {
  stageRegistry().clear();
}

// ---------------------------------------------------------------------------
// 入队 / 触发
// ---------------------------------------------------------------------------

/**
 * 入队理解流水线（内容 `已就绪` 后自动触发，或手动重试）：
 * 创建 AsyncJob(UNDERSTANDING) → 置 understandingStatus=RUNNING → 入队。
 */
export async function enqueueUnderstanding(
  contentId: string,
  traceId: string = randomUUID(),
): Promise<{ jobId: string; traceId: string }> {
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.asyncJob.create({
      data: {
        jobType: JobType.UNDERSTANDING,
        contentId,
        traceId,
        state: 'PENDING',
        attempts: 0,
      },
    });
    await tx.learningContent.update({
      where: { id: contentId },
      data: { understandingStatus: UnderstandStatus.RUNNING },
    });
    return created;
  });
  await dispatchPendingJob(QueueName.UNDERSTANDING, {
    contentId,
    traceId,
    asyncJobId: job.id,
    stage: 'light-filter',
  });
  return { jobId: job.id, traceId };
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

async function ignoreDbError(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // 数据库不可用时不阻断流水线（MVP 允许 mock 跑通）
  }
}

async function setUnderstandingStatus(contentId: string, status: UnderstandStatus): Promise<void> {
  await ignoreDbError(() =>
    prisma.learningContent.update({ where: { id: contentId }, data: { understandingStatus: status } }),
  );
}

/** 运行理解流水线（由 UNDERSTANDING worker 调用） */
export async function runUnderstandingPipeline(payload: JobPayload, ctx: JobContext): Promise<void> {
  const { contentId, traceId, asyncJobId } = payload;
  const degraded: PipelineDegradation = { infer: false, asr: false };

  await setUnderstandingStatus(contentId, UnderstandStatus.RUNNING);

  // 降级探测（best-effort）
  const content = await prisma.learningContent
    .findUnique({ where: { id: contentId }, select: { contentType: true } })
    .catch(() => null);
  const isVideo = content?.contentType === ContentType.VIDEO;

  const asrStatus = getAsrStatus();
  // A configured mock provider is useful for isolated tests, but its generated
  // placeholder segments must never count as real classroom understanding.
  if (isVideo && (!asrStatus.available || asrStatus.provider === 'mock')) {
    degraded.asr = true;
    degraded.asrReason = asrStatus.reason ?? (asrStatus.provider === 'mock' ? '当前为 mock 演示模式' : '服务未配置');
    taskLogger.warn('pipeline: ASR unavailable, semantic products will be skipped', {
      contentId,
      traceId,
      provider: asrStatus.provider,
      reason: asrStatus.reason,
    });
  }
  try {
    await getInferenceGateway().health({ traceId });
  } catch {
    degraded.infer = true;
    taskLogger.warn('pipeline: inference service unreachable, continue with mock degradation', {
      contentId,
      traceId,
    });
  }

  const runPhase = async (phase: RunnablePhase): Promise<void> => {
    if (asyncJobId) await ignoreDbError(() => updateJobStage(asyncJobId, phase));
    const handler = stageRegistry().get(phase);
    if (!handler) {
      const error = new Error(`理解阶段未注册：${phase}`);
      taskLogger.error('pipeline: required stage not registered', { contentId, traceId, phase });
      recordCounter('slp_pipeline_stages_total', { queue: ctx.name, stage: phase, outcome: 'failure' });
      throw error;
    }
    taskLogger.info('pipeline: stage start', { contentId, traceId, phase, attempt: ctx.attempts });
    try {
      await handler({ contentId, traceId, degraded });
      taskLogger.info('pipeline: stage done', { contentId, traceId, phase });
      recordCounter('slp_pipeline_stages_total', { queue: ctx.name, stage: phase, outcome: 'success' });
    } catch (error) {
      recordCounter('slp_pipeline_stages_total', { queue: ctx.name, stage: phase, outcome: 'failure' });
      throw error;
    }
  };

  try {
    await runPhase('light-filter');

    if (degraded.asr) {
      throw new Error(
        `课堂视频语音识别不可用（${degraded.asrReason ?? '没有有效转写结果'}），已跳过 AI 笔记和闪卡生成。检查 ASR 服务后可重试。`,
      );
    }

    await runPhase('deep-extract');
    await runPhase('product-gen');

    if (asyncJobId) await ignoreDbError(() => updateJobStage(asyncJobId, 'completed'));
    await setUnderstandingStatus(contentId, UnderstandStatus.COMPLETED);
    taskLogger.info('pipeline: completed', { contentId, traceId, degraded });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (asyncJobId) await ignoreDbError(() => recordJobErrorReason(asyncJobId, reason));
    await setUnderstandingStatus(contentId, UnderstandStatus.FAILED);
    taskLogger.error('pipeline: failed', {
      contentId,
      traceId,
      error: reason,
    });
    throw err;
  }
}

export { RUNNABLE_PHASES };
