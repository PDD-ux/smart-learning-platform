import { failJob, retryJob, startJob, succeedJob, updateJobStage } from '@/lib/jobs/async-job';
import { taskLogger } from '@/lib/jobs/task-logger';
import { recordCounter } from '@/lib/observability/metrics';
import { prisma } from '@/lib/prisma';
import type { JobContext, JobPayload } from '@/lib/queue';

/**
 * 任务生命周期包装（tasks.md §2.2 / §2.3）
 * ------------------------------------------------------------
 * 统一处理单个阶段：
 *   1. 有 `asyncJobId` 时更新 AsyncJob 状态机（RUNNING → SUCCEEDED / FAILED）与当前阶段；
 *   2. 结构化日志记录阶段、耗时、traceId、尝试次数；
 *   3. 失败时重新抛出，交由队列按重试策略处理；仅在重试耗尽时置 AsyncJob 为 FAILED。
 *
 * 无 asyncJobId 的兼容入口可独立运行；有 ID 时必须认领成功，数据库异常不降级执行。
 */

export class JobNotImplementedError extends Error {
  constructor(taskRef: string, queue: string) {
    super(`${queue} 处理器尚未实现（tasks.md ${taskRef}）`);
    this.name = 'JobNotImplementedError';
  }
}

async function ignoreDbError(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // AsyncJob 落库失败不阻断任务执行（数据库未就绪时仍可跑通进程内队列）
  }
}

async function tryDb<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const UNDERSTANDING_FAILURE_STAGES = new Set(['light-filter', 'deep-extract', 'product-gen']);

async function failureStage(jobId: string | undefined, ctx: JobContext, fallback: string): Promise<string> {
  if (!jobId || ctx.name !== 'UNDERSTANDING') return fallback;
  const current = await tryDb(() => prisma.asyncJob.findUnique({ where: { id: jobId }, select: { stage: true } }));
  return current?.stage && UNDERSTANDING_FAILURE_STAGES.has(current.stage) ? current.stage : fallback;
}

export async function runStage(
  payload: JobPayload,
  ctx: JobContext,
  stage: string,
  fn: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  const jobId = payload.asyncJobId;

  if (jobId) {
    if (!(await startJob(jobId))) {
      taskLogger.info('async job not claimed, skip duplicate execution', { jobId, queue: ctx.name });
      return;
    }
  }

  taskLogger.info('job stage start', {
    queue: ctx.name,
    jobId,
    contentId: payload.contentId,
    traceId: payload.traceId,
    stage,
    attempt: ctx.attempts,
    maxAttempts: ctx.maxAttempts,
  });

  try {
    if (jobId) await updateJobStage(jobId, stage);
    await fn();
    const durationMs = Date.now() - startedAt;
    if (jobId) {
      await ignoreDbError(() => succeedJob(jobId, durationMs));
    }
    taskLogger.info('job stage done', {
      queue: ctx.name,
      jobId,
      contentId: payload.contentId,
      traceId: payload.traceId,
      stage,
      durationMs,
    });
    recordCounter('slp_pipeline_stages_total', { queue: ctx.name, stage, outcome: 'success' });
    if (ctx.name === 'CONTENT_PARSE') {
      recordCounter('slp_import_jobs_total', { outcome: 'success' });
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const reason = err instanceof Error ? err.message : String(err);
    const exhausted = ctx.attempts >= ctx.maxAttempts;
    const failedStage = await failureStage(jobId, ctx, stage);
    if (jobId && exhausted) {
      await ignoreDbError(() => failJob(jobId, reason, durationMs));
    } else if (jobId) {
      await retryJob(jobId, reason);
    }
    taskLogger.error('job stage failed', {
      queue: ctx.name,
      jobId,
      contentId: payload.contentId,
      traceId: payload.traceId,
      stage: failedStage,
      attempt: ctx.attempts,
      exhausted,
      durationMs,
      error: reason,
    });
    recordCounter('slp_pipeline_stages_total', { queue: ctx.name, stage: failedStage, outcome: 'failure' });
    if (ctx.name === 'CONTENT_PARSE' && exhausted) {
      recordCounter('slp_import_jobs_total', { outcome: 'failure' });
    }
    throw err;
  }
}
