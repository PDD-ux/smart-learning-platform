import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  appUrl,
  DEFAULT_CONTENT_TYPE,
  localRoot,
  presignedExpiresSec,
} from './config';
import { contentTypeFromKey } from './keys';
import { signStorageToken } from './tokens';
import {
  StorageError,
  type ByteRange,
  type DeleteManyResult,
  type ObjectStat,
  type PresignResult,
  type ReadResult,
  type StorageClient,
} from './types';

export class LocalStorageClient implements StorageClient {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string = localRoot()) {
    this.root = path.resolve(root);
  }

  /** Immutable classroom files: must never replace an existing object's bytes. */
  async putObjectIfAbsent(key: string, data: Buffer, _contentType: string): Promise<boolean> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, data, { flag: 'wx' });
      return true;
    } catch (reason) {
      if (typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'EEXIST') {
        return false;
      }
      throw reason;
    }
  }

  /** 将存储键解析为绝对路径，拒绝越出根目录的路径穿越 */
  private resolve(key: string): string {
    const abs = path.resolve(this.root, key);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new StorageError('INVALID_KEY', `storage key escapes root: ${key}`);
    }
    return abs;
  }

  /** local 驱动：返回对象在本地磁盘的绝对路径（供 ffprobe/ffmpeg 就地读取） */
  localFilePath(key: string): string {
    return this.resolve(key);
  }

  async createUploadUrl(
    key: string,
    opts: { contentType?: string; expiresInSec?: number } = {},
  ): Promise<PresignResult> {
    this.resolve(key);
    const expiresInSec = opts.expiresInSec ?? presignedExpiresSec();
    const expiresAt = Date.now() + expiresInSec * 1_000;
    const sig = signStorageToken('put', key, expiresAt);
    const url =
      `${appUrl()}/api/storage/upload` +
      `?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${sig}`;
    return {
      url,
      method: 'PUT',
      expiresInSec,
      headers: { 'Content-Type': opts.contentType ?? DEFAULT_CONTENT_TYPE },
    };
  }

  async createReadUrl(
    key: string,
    opts: { expiresInSec?: number; downloadFileName?: string } = {},
  ): Promise<PresignResult> {
    this.resolve(key);
    const expiresInSec = opts.expiresInSec ?? presignedExpiresSec();
    const expiresAt = Date.now() + expiresInSec * 1_000;
    const sig = signStorageToken('get', key, expiresAt);
    const download = opts.downloadFileName
      ? `&download=${encodeURIComponent(opts.downloadFileName)}`
      : '';
    const url =
      `${appUrl()}/api/storage/object` +
      `?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${sig}${download}`;
    return { url, method: 'GET', expiresInSec, headers: {} };
  }

  async putObject(
    key: string,
    data: Buffer | Readable,
    _opts: { contentType?: string } = {},
  ): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    if (Buffer.isBuffer(data)) {
      await writeFile(file, data);
    } else {
      await pipeline(data, createWriteStream(file));
    }
  }

  async getObject(key: string, range?: ByteRange): Promise<ReadResult> {
    const file = this.resolve(key);
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) {
      throw new StorageError('NOT_FOUND', `object not found: ${key}`);
    }
    const contentType = contentTypeFromKey(key);
    if (!range) {
      return { stream: createReadStream(file), contentLength: st.size, contentType, acceptRanges: true };
    }
    const start = Math.max(0, Math.floor(range.start));
    const end = Math.min(range.end ?? st.size - 1, st.size - 1);
    if (start > end || start >= st.size) {
      throw new StorageError('RANGE_NOT_SATISFIABLE', `invalid range for ${key}`);
    }
    return {
      stream: createReadStream(file, { start, end }),
      contentLength: end - start + 1,
      contentType,
      acceptRanges: true,
      contentRange: `bytes ${start}-${end}/${st.size}`,
    };
  }

  async statObject(key: string): Promise<ObjectStat | null> {
    const st = await stat(this.resolve(key)).catch(() => null);
    if (!st || !st.isFile()) return null;
    return { size: st.size, contentType: contentTypeFromKey(key) };
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deleteObjects(keys: string[]): Promise<DeleteManyResult> {
    const failed: string[] = [];
    let deleted = 0;
    for (const key of keys) {
      try {
        await this.deleteObject(key);
        deleted += 1;
      } catch {
        failed.push(key);
      }
    }
    return { deleted, failed };
  }

  async deletePrefix(prefix: string): Promise<{ deleted: number }> {
    const dir = this.resolve(prefix);
    let deleted = 0;
    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(target);
        } else {
          await rm(target, { force: true });
          deleted += 1;
        }
      }
    };
    await walk(dir);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { deleted };
  }
}
