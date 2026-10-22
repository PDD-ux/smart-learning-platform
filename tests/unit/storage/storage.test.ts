import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  LocalStorageClient,
  StorageError,
  buildContentKey,
  buildFrameKey,
  cleanupContentObjects,
  contentTypeFromKey,
  getStorageDriver,
  signStorageToken,
  verifyStorageToken,
} from '@/lib/storage';

/**
 * 存储客户端 单测（tasks.md §3.1）
 * ------------------------------------------------------------
 * 覆盖：键约定、驱动选择、本地读写、HTTP Range、删除与前缀清理、预签名令牌、路径穿越防护。
 */

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('storage key conventions', () => {
  it('builds content keys and strips path separators from file names', () => {
    expect(buildContentKey('c1', 'lesson.mp4')).toBe('contents/c1/lesson.mp4');
    expect(buildContentKey('c1', '..\\evil/../x.mp4')).toBe('contents/c1/.._evil_.._x.mp4');
  });

  it('builds zero-padded frame keys', () => {
    expect(buildFrameKey('c1', 7)).toBe('frames/c1/00007.jpg');
    expect(buildFrameKey('c1', 7, 'png')).toBe('frames/c1/00007.png');
  });

  it('maps common extensions to content types', () => {
    expect(contentTypeFromKey('a/b.mp4')).toBe('video/mp4');
    expect(contentTypeFromKey('a/b.pdf')).toBe('application/pdf');
    expect(contentTypeFromKey('a/b.unknown')).toBe('application/octet-stream');
  });
});

describe('storage driver selection', () => {
  it('defaults to local', () => {
    vi.stubEnv('STORAGE_DRIVER', '');
    expect(getStorageDriver()).toBe('local');
    vi.unstubAllEnvs();
  });

  it('selects s3 when explicitly configured', () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    expect(getStorageDriver()).toBe('s3');
    vi.unstubAllEnvs();
  });
});

describe('LocalStorageClient', () => {
  let root: string;
  let client: LocalStorageClient;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'slp-storage-'));
    client = new LocalStorageClient(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('puts and stats an object', async () => {
    await client.putObject('contents/c1/a.txt', Buffer.from('hello'));
    const st = await client.statObject('contents/c1/a.txt');
    expect(st).toEqual({ size: 5, contentType: 'text/plain; charset=utf-8' });
  });

  it('reads the full object back', async () => {
    await client.putObject('contents/c1/full.txt', Buffer.from('abcdef'));
    const out = await client.getObject('contents/c1/full.txt');
    expect(out.contentLength).toBe(6);
    expect(out.acceptRanges).toBe(true);
    expect(await readAll(out.stream)).toBe('abcdef');
  });

  it('supports HTTP Range reads', async () => {
    await client.putObject('contents/c1/range.txt', Buffer.from('0123456789'));
    const out = await client.getObject('contents/c1/range.txt', { start: 2, end: 5 });
    expect(out.contentLength).toBe(4);
    expect(out.contentRange).toBe('bytes 2-5/10');
    expect(await readAll(out.stream)).toBe('2345');
  });

  it('rejects an unsatisfiable range', async () => {
    await client.putObject('contents/c1/r2.txt', Buffer.from('abc'));
    await expect(client.getObject('contents/c1/r2.txt', { start: 9 })).rejects.toMatchObject({
      code: 'RANGE_NOT_SATISFIABLE',
    });
  });

  it('throws NOT_FOUND for a missing object', async () => {
    await expect(client.getObject('contents/c1/missing.txt')).rejects.toBeInstanceOf(StorageError);
  });

  it('deletes a single object', async () => {
    await client.putObject('contents/c1/del.txt', Buffer.from('x'));
    await client.deleteObject('contents/c1/del.txt');
    expect(await client.statObject('contents/c1/del.txt')).toBeNull();
  });

  it('deletes many objects and reports failures', async () => {
    await client.putObject('contents/c2/1.txt', Buffer.from('1'));
    await client.putObject('contents/c2/2.txt', Buffer.from('2'));
    const result = await client.deleteObjects(['contents/c2/1.txt', 'contents/c2/2.txt']);
    expect(result).toEqual({ deleted: 2, failed: [] });
  });

  it('cleans up all objects under a prefix', async () => {
    await client.putObject('frames/c3/00001.jpg', Buffer.from('a'));
    await client.putObject('frames/c3/00002.jpg', Buffer.from('b'));
    const result = await client.deletePrefix('frames/c3/');
    expect(result.deleted).toBe(2);
    expect(await client.statObject('frames/c3/00001.jpg')).toBeNull();
  });

  it('rejects path traversal outside the storage root', async () => {
    await expect(client.putObject('../escape.txt', Buffer.from('x'))).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
  });

  it('cleans up both content and frame objects for a content id', async () => {
    await client.putObject(buildContentKey('c9', 'video.mp4'), Buffer.from('v'));
    await client.putObject(buildFrameKey('c9', 1), Buffer.from('f'));
    const result = await cleanupContentObjects('c9', client);
    expect(result.deleted).toBe(2);
  });
});

describe('local presigned token', () => {
  it('signs and verifies a token', () => {
    vi.stubEnv('STORAGE_SIGN_SECRET', 'unit-secret');
    const expires = Date.now() + 60_000;
    const sig = signStorageToken('put', 'contents/c1/a.mp4', expires);
    expect(verifyStorageToken('put', 'contents/c1/a.mp4', sig, expires)).toBe(true);
    vi.unstubAllEnvs();
  });

  it('rejects an expired token', () => {
    vi.stubEnv('STORAGE_SIGN_SECRET', 'unit-secret');
    const expires = Date.now() - 1;
    const sig = signStorageToken('put', 'contents/c1/a.mp4', expires);
    expect(verifyStorageToken('put', 'contents/c1/a.mp4', sig, expires)).toBe(false);
    vi.unstubAllEnvs();
  });

  it('rejects a tampered key or wrong action', () => {
    vi.stubEnv('STORAGE_SIGN_SECRET', 'unit-secret');
    const expires = Date.now() + 60_000;
    const sig = signStorageToken('put', 'contents/c1/a.mp4', expires);
    expect(verifyStorageToken('put', 'contents/c1/b.mp4', sig, expires)).toBe(false);
    expect(verifyStorageToken('get', 'contents/c1/a.mp4', sig, expires)).toBe(false);
    vi.unstubAllEnvs();
  });

  it('produces signed upload and read urls', async () => {
    vi.stubEnv('STORAGE_SIGN_SECRET', 'unit-secret');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    const client = new LocalStorageClient(path.join(tmpdir(), 'slp-storage-url'));
    const put = await client.createUploadUrl('contents/c1/a.mp4', { contentType: 'video/mp4' });
    expect(put.method).toBe('PUT');
    expect(put.url).toContain('/api/storage/upload?key=');
    expect(put.headers['Content-Type']).toBe('video/mp4');
    const get = await client.createReadUrl('contents/c1/a.mp4');
    expect(get.method).toBe('GET');
    expect(get.url).toContain('/api/storage/object?key=');
    vi.unstubAllEnvs();
  });
});
