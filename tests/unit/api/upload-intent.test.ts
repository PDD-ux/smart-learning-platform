import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), jobCount: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createUploadUrl: vi.fn(),
  driver: 'local',
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { deleteMany: mocks.deleteMany, findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    asyncJob: { count: mocks.jobCount },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ learningContent: { create: mocks.create, update: mocks.update } }),
  },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    getStorage: () => ({ driver: mocks.driver, createUploadUrl: mocks.createUploadUrl }),
  };
});

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, retryAfter: 0 })),
  RateLimitPolicy: {
    default: { limit: 60, windowMs: 60_000 },
    auth: { limit: 5, windowMs: 60_000 },
    ai: { limit: 20, windowMs: 60_000 },
  },
  getClientIp: () => '127.0.0.1',
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { StorageError } from '@/lib/storage';
import { POST } from '@/app/api/contents/upload-intent/route';

/**
 * upload-intent 路由 单测（tasks.md §3.2）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(body: unknown, withAuth = true): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/upload-intent', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const validBody = {
  contentType: 'video',
  fileName: 'lesson.mp4',
  fileSize: 1024,
  mimeType: 'video/mp4',
};

describe('POST /api/contents/upload-intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.driver = 'local';
    mocks.findUnique.mockResolvedValue({ id:'old-id',ownerId:'u1',contentType:'VIDEO',fileName:'lesson.mp4',fileSizeBytes:1024n,status:'PENDING',understandingStatus:'NONE',storageKey:'contents/old-id/lesson.mp4',updatedAt:new Date() });
    mocks.deleteMany.mockResolvedValue({count:1}); mocks.updateMany.mockResolvedValue({count:1}); mocks.jobCount.mockResolvedValue(0);
    mocks.create.mockResolvedValue({ id: 'cuid_1' });
    mocks.update.mockResolvedValue({
      id: 'cuid_1',
      storageKey: 'contents/cuid_1/lesson.mp4',
    });
    mocks.createUploadUrl.mockResolvedValue({
      url: 'http://localhost:3000/api/storage/upload?key=contents%2Fcuid_1%2Flesson.mp4&sig=x',
      method: 'PUT',
      expiresInSec: 3600,
      headers: {},
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await POST(makeRequest(validBody, false), undefined as never);
    expect(res.status).toBe(401);
  });

  it('creates a pending record and returns a presigned url', async () => {
    const res = await POST(makeRequest(validBody), undefined as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      contentId: 'cuid_1',
      uploadUrl: expect.stringContaining('/api/storage/upload'),
      expiresInSec: 3600,
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'u1',
          contentType: 'VIDEO',
          format: 'MP4',
          status: 'PENDING',
        }),
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'cuid_1' },
      data: { storageKey: 'contents/cuid_1/lesson.mp4' },
    });
  });

  it('rejects unsupported formats without touching the database', async () => {
    const res = await POST(makeRequest({ ...validBody, fileName: 'clip.avi' }), undefined as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNSUPPORTED_FORMAT');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns local uploads relative to the browser origin, preserving the signed query', async () => {
    const res = await POST(makeRequest(validBody), undefined as never);
    const body = await res.json();
    expect(body.data.uploadUrl).toBe('/api/storage/upload?key=contents%2Fcuid_1%2Flesson.mp4&sig=x');
  });

  it('preserves the external S3 signed URL exactly', async () => {
    mocks.driver = 's3';
    const url = 'https://bucket.example.invalid/object?X-Amz-Signature=test';
    mocks.createUploadUrl.mockResolvedValueOnce({ url, expiresInSec: 3600 });
    const res = await POST(makeRequest(validBody), undefined as never);
    expect((await res.json()).data.uploadUrl).toBe(url);
  });

  it('rejects oversized files', async () => {
    const res = await POST(
      makeRequest({ ...validBody, fileSize: 3 * 1024 ** 3 }),
      undefined as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('returns 503 when storage is unavailable', async () => {
    mocks.createUploadUrl.mockRejectedValueOnce(new StorageError('UNAVAILABLE', 'no bucket'));
    const res = await POST(makeRequest(validBody), undefined as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(mocks.deleteMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'cuid_1',ownerId:'u1',status:'PENDING'})}));
  });

  it('rejects malformed payloads with VALIDATION_FAILED', async () => {
    const res = await POST(makeRequest({ contentType: 'video' }), undefined as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});

beforeEach((): void => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({id:'old-id',ownerId:'u1',contentType:'VIDEO',fileName:'lesson.mp4',fileSizeBytes:1024n,status:'PENDING',understandingStatus:'NONE',storageKey:'contents/old-id/lesson.mp4',updatedAt:new Date()});
  mocks.deleteMany.mockResolvedValue({count:1}); mocks.updateMany.mockResolvedValue({count:1}); mocks.jobCount.mockResolvedValue(0);
  mocks.createUploadUrl.mockResolvedValue({url:'http://localhost:3000/api/storage/upload?sig=fixture',expiresInSec:3600});
});
it('renews an owned pending intent without creating another content row', async (): Promise<void> => {
  const res=await POST(makeRequest({...validBody,contentId:'old-id'}),undefined as never);
  expect(res.status).toBe(200); expect((await res.json()).data.contentId).toBe('old-id');
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.updateMany).toHaveBeenCalledTimes(1);
});
it.each([{ownerId:'other',status:403},{status:'PARSING',expected:409},{fileSizeBytes:2048n,expected:409}])('rejects unsafe intent reuse', async (change): Promise<void> => {
  const row={id:'old-id',ownerId:'u1',contentType:'VIDEO',fileName:'lesson.mp4',fileSizeBytes:1024n,status:'PENDING',understandingStatus:'NONE',storageKey:'contents/old-id/lesson.mp4',updatedAt:new Date()};
  const {expected,...fields}=change; mocks.findUnique.mockResolvedValue({...row,...fields});
  const res=await POST(makeRequest({...validBody,contentId:'old-id'}),undefined as never);
  expect(res.status).toBe(expected ?? 403); expect(mocks.create).not.toHaveBeenCalled();
});
it('rejects a pending record with an existing task or changed lease', async (): Promise<void> => {
  mocks.jobCount.mockResolvedValueOnce(1);
  expect((await POST(makeRequest({...validBody,contentId:'old-id'}),undefined as never)).status).toBe(409);
  mocks.updateMany.mockResolvedValueOnce({count:0});
  expect((await POST(makeRequest({...validBody,contentId:'old-id'}),undefined as never)).status).toBe(409);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('keeps an existing intent when renewal signing fails', async (): Promise<void> => {
  mocks.createUploadUrl.mockRejectedValueOnce(new StorageError('UNAVAILABLE','fixture failure'));
  const res=await POST(makeRequest({...validBody,contentId:'old-id'}),undefined as never);
  expect(res.status).toBe(503); expect(mocks.deleteMany).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
