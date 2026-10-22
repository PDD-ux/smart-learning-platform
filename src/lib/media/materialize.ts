import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { StorageClient } from '@/lib/storage';

/**
 * 将对象存储对象落地为本地文件（tasks.md §3.2 / §6.3）
 * ------------------------------------------------------------
 * - local 驱动：直接返回原文件路径（零拷贝）；
 * - s3 驱动：流式下载到系统临时文件，调用方负责 `cleanup()`。
 * 供 ffprobe / ffmpeg / ASR 等需要本地路径的工具复用。
 */

export type MaterializedObject = {
  filePath: string;
  cleanup: () => Promise<void>;
};

export async function materializeObject(
  storage: StorageClient,
  storageKey: string,
): Promise<MaterializedObject> {
  const local = storage.localFilePath?.(storageKey);
  if (local) {
    return { filePath: local, cleanup: async () => undefined };
  }
  const tempPath = path.join(tmpdir(), `slp-media-${randomUUID()}`);
  const { stream } = await storage.getObject(storageKey);
  await pipeline(stream, createWriteStream(tempPath));
  return { filePath: tempPath, cleanup: async () => rm(tempPath, { force: true }) };
}
