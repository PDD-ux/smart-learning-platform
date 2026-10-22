import type { JobContext, JobPayload } from '@/lib/queue';
import { runUnderstandingPipeline } from '@/lib/jobs/pipeline/understanding-pipeline';

import { runStage } from './lifecycle';

/**
 * UNDERSTANDING worker（tasks.md §6.2）
 * ------------------------------------------------------------
 * 端云协同结构化理解流水线入口：light-filter → deep-extract → product-gen。
 * 编排与降级逻辑见 `src/lib/jobs/pipeline/understanding-pipeline.ts`；
 * 各阶段处理器由 §6.3 / §6.4 通过 `registerPipelineStage` 注册。
 */
export async function understandingProcessor(payload: JobPayload, ctx: JobContext): Promise<void> {
  await runStage(payload, ctx, 'light-filter', async () => {
    await runUnderstandingPipeline(payload, ctx);
  });
}
