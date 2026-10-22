import type { JobContext, JobPayload } from '@/lib/queue';
import { JobNotImplementedError, runStage } from './lifecycle';

/**
 * PRODUCT_GEN worker 脚手架（tasks.md §2.2）
 * ------------------------------------------------------------
 * 产物生成：闪卡、章节化笔记、知识图谱关系边。
 * 与知识抽取解耦，可独立重试/失败（规避巨型 prompt）。
 *
 * 实际实现见 tasks.md §6.4（云端深度理解）。
 */
export async function productGenProcessor(payload: JobPayload, ctx: JobContext): Promise<void> {
  if (payload.stage === 'exam-generation') {
    // Retired feature: discard duplicate/late messages without DB, AI or output writes.
    return;
  }
  await runStage(payload, ctx, 'product-gen', async () => {
    // TODO(tasks.md §6.4)：按知识点生成闪卡/笔记/图谱边，落库前过内容安全过滤。
    throw new JobNotImplementedError('§6.4', ctx.name);
  });
}
