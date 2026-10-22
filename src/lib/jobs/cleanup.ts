import { taskLogger } from '@/lib/jobs/task-logger';
import {
  cleanupContentObjects,
  coverKeyPrefix,
  frameKeyPrefix,
  getStorage,
} from '@/lib/storage';

/**
 * 导入失败清理（tasks.md §3.2）
 * ------------------------------------------------------------
 * - `cleanupDerivedObjects`：删除派生残留（关键帧 frames/ + 封面 covers/），
 *   保留源文件，使学习者可直接重试解析（complete 允许 FAILED → PARSING）。
 * - `scheduleContentCleanup`：异步执行清理，不阻塞主流程；失败仅记录日志。
 */

export async function cleanupDerivedObjects(
  contentId: string,
  storage = getStorage(),
): Promise<{ deleted: number }> {
  const frames = await storage.deletePrefix(frameKeyPrefix(contentId));
  const covers = await storage.deletePrefix(coverKeyPrefix(contentId));
  return { deleted: frames.deleted + covers.deleted };
}

export type CleanupOptions = {
  /** true：仅清理派生残留（保留源文件）；false：清理该内容全部对象 */
  derivedOnly?: boolean;
};

/** 异步清理存储残留（fire-and-forget）；调用方可 `void scheduleContentCleanup(...)` */
export async function scheduleContentCleanup(
  contentId: string,
  options: CleanupOptions = {},
): Promise<void> {
  const derivedOnly = options.derivedOnly ?? false;
  try {
    const result = derivedOnly
      ? await cleanupDerivedObjects(contentId)
      : await cleanupContentObjects(contentId);
    taskLogger.info('storage cleanup done', {
      contentId,
      deleted: result.deleted,
      derivedOnly,
    });
  } catch (err) {
    taskLogger.error('storage cleanup failed', {
      contentId,
      derivedOnly,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
