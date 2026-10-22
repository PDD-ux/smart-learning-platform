import { getStorageDriver } from './config';
import { LocalStorageClient } from './local-client';
import { S3StorageClient } from './s3-client';
import type { StorageClient } from './types';
import { contentKeyPrefix, coverKeyPrefix, frameKeyPrefix } from './keys';

const globalForStorage = globalThis as unknown as { __slpStorage?: StorageClient };

export function getStorage(): StorageClient {
  // Next dev preserves globals across HMR; replace a pre-immutable-write adapter once.
  if (!globalForStorage.__slpStorage || typeof globalForStorage.__slpStorage.putObjectIfAbsent !== 'function') {
    globalForStorage.__slpStorage =
      getStorageDriver() === 's3' ? new S3StorageClient() : new LocalStorageClient();
  }
  return globalForStorage.__slpStorage;
}

/** 测试辅助：重置单例（驱动/根目录切换后重新构造） */
export function __resetStorageForTest(): void {
  globalForStorage.__slpStorage = undefined;
}

/**
 * 对象残留异步清理工具（tasks.md §3.1 · P1）
 * 删除某内容关联的全部对象：内容原文件（contents/<id>/）、关键帧（frames/<id>/）与封面。
 * 供导入失败清理与内容级联删除复用。
 */
export async function cleanupContentObjects(
  contentId: string,
  storage: StorageClient = getStorage(),
): Promise<{ deleted: number }> {
  const contents = await storage.deletePrefix(contentKeyPrefix(contentId));
  const frames = await storage.deletePrefix(frameKeyPrefix(contentId));
  const covers = await storage.deletePrefix(coverKeyPrefix(contentId));
  return { deleted: contents.deleted + frames.deleted + covers.deleted };
}
