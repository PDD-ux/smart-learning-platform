import { Readable } from 'node:stream';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  verifyStorageToken: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { learningContent: { findFirst: mocks.findFirst } },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    verifyStorageToken: mocks.verifyStorageToken,
    getStorage: () => ({ putObject: mocks.putObject, deleteObject: mocks.deleteObject }),
  };
});

import { PUT } from '@/app/api/storage/upload/route';

function request(body: string, contentLength?: number): NextRequest {
  const headers = new Headers({ 'content-type': 'video/mp4' });
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    url: 'http://localhost/api/storage/upload?key=contents%2Fc1%2Fvideo.mp4&expires=9999999999999&sig=valid',
    headers,
    body: stream,
  } as unknown as NextRequest;
}

describe('PUT /api/storage/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyStorageToken.mockReturnValue(true);
    mocks.findFirst.mockResolvedValue({ fileSizeBytes: BigInt(4) });
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.putObject.mockImplementation(async (_key: string, body: Readable) => {
      for await (const _chunk of body) {
        // 消费流，令大小校验器执行。
      }
    });
  });

  it('rejects a signed URL whose storage key no longer belongs to pending content', async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    const res = await PUT(request('four', 4));
    expect(res.status).toBe(403);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('rejects a declared content length that differs from the upload intent', async () => {
    const res = await PUT(request('four', 3));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('removes a partial object when the streamed byte count differs from the upload intent', async () => {
    const res = await PUT(request('two', 4));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(mocks.deleteObject).toHaveBeenCalledWith('contents/c1/video.mp4');
  });

  it('stores an upload only after its stream exactly matches the intended size', async () => {
    const res = await PUT(request('four', 4));
    expect(res.status).toBe(200);
    expect(mocks.putObject).toHaveBeenCalledWith(
      'contents/c1/video.mp4',
      expect.any(Readable),
      { contentType: 'video/mp4' },
    );
  });
});
