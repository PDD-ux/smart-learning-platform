import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupDerivedObjects, scheduleContentCleanup } from '@/lib/jobs/cleanup';
import {
  __resetStorageForTest,
  buildContentKey,
  buildCoverKey,
  buildFrameKey,
  getStorage,
} from '@/lib/storage';

/**
 * 导入失败清理 单测（tasks.md §3.2）
 */

describe('cleanup', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'slp-cleanup-'));
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('UPLOAD_DIR', root);
    __resetStorageForTest();
  });

  afterEach(async () => {
    __resetStorageForTest();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function seed(): Promise<void> {
    const storage = getStorage();
    await storage.putObject(buildContentKey('c1', 'video.mp4'), Buffer.from('v'));
    await storage.putObject(buildFrameKey('c1', 1), Buffer.from('f'));
    await storage.putObject(buildCoverKey('c1'), Buffer.from('c'));
  }

  it('cleanupDerivedObjects removes frames and covers but keeps the source', async () => {
    await seed();
    const storage = getStorage();

    const result = await cleanupDerivedObjects('c1', storage);

    expect(result.deleted).toBe(2);
    expect(await storage.statObject(buildFrameKey('c1', 1))).toBeNull();
    expect(await storage.statObject(buildCoverKey('c1'))).toBeNull();
    expect(await storage.statObject(buildContentKey('c1', 'video.mp4'))).not.toBeNull();
  });

  it('scheduleContentCleanup with derivedOnly keeps the source file', async () => {
    await seed();
    await scheduleContentCleanup('c1', { derivedOnly: true });
    const storage = getStorage();
    expect(await storage.statObject(buildFrameKey('c1', 1))).toBeNull();
    expect(await storage.statObject(buildContentKey('c1', 'video.mp4'))).not.toBeNull();
  });

  it('scheduleContentCleanup without options removes every object', async () => {
    await seed();
    await scheduleContentCleanup('c1');
    const storage = getStorage();
    expect(await storage.statObject(buildContentKey('c1', 'video.mp4'))).toBeNull();
    expect(await storage.statObject(buildFrameKey('c1', 1))).toBeNull();
    expect(await storage.statObject(buildCoverKey('c1'))).toBeNull();
  });

  it('never throws when cleanup fails', async () => {
    // 强制切到 s3 驱动但缺少 bucket → deletePrefix 抛错，scheduleContentCleanup 应吞掉异常
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_BUCKET', '');
    __resetStorageForTest();
    await expect(scheduleContentCleanup('c1')).resolves.toBeUndefined();
  });
});
