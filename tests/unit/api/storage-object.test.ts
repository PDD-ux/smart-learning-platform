import { Readable } from 'node:stream';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getObject: vi.fn(),
  statObject: vi.fn(),
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    getStorage: () => ({ getObject: mocks.getObject, statObject: mocks.statObject }),
  };
});

import { StorageError, signStorageToken } from '@/lib/storage';
import { GET } from '@/app/api/storage/object/route';
import { parseRangeHeader } from '@/lib/storage-range';

/**
 * GET /api/storage/object 单测（tasks.md §4.1）
 */

const KEY = 'contents/c1/lesson.mp4';

function signedUrl(): string {
  const expires = Date.now() + 60_000;
  const sig = signStorageToken('get', KEY, expires);
  return `http://localhost/api/storage/object?key=${encodeURIComponent(KEY)}&expires=${expires}&sig=${sig}`;
}

function makeRequest(url = signedUrl(), range?: string): NextRequest {
  const headers = new Headers();
  if (range) headers.set('range', range);
  return new NextRequest(url, { headers });
}

describe('parseRangeHeader', () => {
  it('parses start-end, open-ended and suffix forms', () => {
    expect(parseRangeHeader('bytes=2-5')).toEqual({ start: 2, end: 5 });
    expect(parseRangeHeader('bytes=2-')).toEqual({ start: 2, end: undefined });
    expect(parseRangeHeader('bytes=-100')).toEqual({ suffix: 100 });
    expect(parseRangeHeader(null)).toBeNull();
    expect(parseRangeHeader('bytes=-')).toBeNull();
    expect(parseRangeHeader('items=1-2')).toBeNull();
  });
});

describe('GET /api/storage/object', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STORAGE_SIGN_SECRET', 'unit-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an invalid or missing signature with 403', async () => {
    const res = await GET(makeRequest('http://localhost/api/storage/object?key=x&sig=bad&expires=999'));
    expect(res.status).toBe(403);
  });

  it('serves the full object with range support headers', async () => {
    mocks.getObject.mockResolvedValueOnce({
      stream: Readable.from(Buffer.from('abcdef')),
      contentLength: 6,
      contentType: 'video/mp4',
      acceptRanges: true,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-length')).toBe('6');
    expect(await res.text()).toBe('abcdef');
    expect(mocks.getObject).toHaveBeenCalledWith(KEY, undefined);
  });

  it('serves a byte range with 206 and Content-Range', async () => {
    mocks.getObject.mockResolvedValueOnce({
      stream: Readable.from(Buffer.from('cde')),
      contentLength: 3,
      contentType: 'video/mp4',
      acceptRanges: true,
      contentRange: 'bytes 2-4/6',
    });

    const res = await GET(makeRequest(signedUrl(), 'bytes=2-4'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(await res.text()).toBe('cde');
    expect(mocks.getObject).toHaveBeenCalledWith(KEY, { start: 2, end: 4 });
  });

  it('sets a sanitized attachment filename for local presigned downloads', async () => {
    mocks.getObject.mockResolvedValueOnce({
      stream: Readable.from(Buffer.from('notes')),
      contentLength: 5,
      contentType: 'text/markdown; charset=utf-8',
      acceptRanges: true,
    });

    const res = await GET(makeRequest(`${signedUrl()}&download=${encodeURIComponent('学习笔记\"\r\n.md')}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="_______.md"');
  });

  it('resolves a suffix range using the object size', async () => {
    mocks.statObject.mockResolvedValueOnce({ size: 100, contentType: 'video/mp4' });
    mocks.getObject.mockResolvedValueOnce({
      stream: Readable.from(Buffer.from('x')),
      contentLength: 10,
      contentType: 'video/mp4',
      acceptRanges: true,
      contentRange: 'bytes 90-99/100',
    });

    const res = await GET(makeRequest(signedUrl(), 'bytes=-10'));
    expect(res.status).toBe(206);
    expect(mocks.getObject).toHaveBeenCalledWith(KEY, { start: 90 });
  });

  it('returns 404 when the object is missing', async () => {
    mocks.getObject.mockRejectedValueOnce(new StorageError('NOT_FOUND', 'gone'));
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 416 for an unsatisfiable range', async () => {
    mocks.getObject.mockRejectedValueOnce(new StorageError('RANGE_NOT_SATISFIABLE', 'bad'));
    const res = await GET(makeRequest(signedUrl(), 'bytes=999-'));
    expect(res.status).toBe(416);
  });
});
