import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  createJob: vi.fn(),
  statObject: vi.fn(),
  deleteObject: vi.fn(),
  enqueue: vi.fn(),
  registerAllProcessors: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.findUnique },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        learningContent: { updateMany: mocks.update },
        asyncJob: { create: mocks.createJob },
      }),
  },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return { ...actual, getStorage: () => ({ statObject: mocks.statObject, deleteObject: mocks.deleteObject }) };
});

vi.mock('@/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue');
  return { ...actual, enqueue: mocks.enqueue };
});

vi.mock('@/lib/jobs/workers', () => ({
  registerAllProcessors: mocks.registerAllProcessors,
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { QueueName } from '@/lib/queue';
import { POST } from '@/app/api/contents/[id]/complete/route';

/**
 * complete 路由 单测（tasks.md §3.2）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

const baseContent = {
  id: 'c1',
  ownerId: 'u1',
  storageKey: 'contents/c1/lesson.mp4',
  fileSizeBytes: BigInt(1024),
  status: 'PENDING',
};

describe('POST /api/contents/:id/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ ...baseContent });
    mocks.statObject.mockResolvedValue({ size: 1024, contentType: 'video/mp4' });
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.createJob.mockResolvedValue({ id: 'job_1' });
    mocks.enqueue.mockResolvedValue('mem_1');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await POST(makeRequest(false), { params: { id: 'c1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when content does not exist', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('CONTENT_NOT_FOUND');
  });

  it('returns 403 when the requester is not the owner', async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...baseContent, ownerId: 'other' });
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('returns 409 IMPORT_IN_PROGRESS when already parsing or ready', async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...baseContent, status: 'PARSING' });
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('IMPORT_IN_PROGRESS');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('returns 409 UPLOAD_SIZE_MISMATCH when the stored object is missing', async () => {
    mocks.statObject.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('returns 409 UPLOAD_SIZE_MISMATCH when sizes differ', async () => {
    mocks.statObject.mockResolvedValueOnce({ size: 999, contentType: 'video/mp4' });
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(mocks.deleteObject).toHaveBeenCalledWith(baseContent.storageKey);
  });

  it('drives status to parsing, creates a job and enqueues a parse task', async () => {
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ contentId: 'c1', status: '解析中' });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'c1', ownerId: 'u1', status: { in: ['PENDING', 'UPLOADING', 'FAILED'] } },
      data: { status: 'PARSING', failReason: null },
    });
    expect(mocks.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobType: 'CONTENT_PARSE', contentId: 'c1', state: 'PENDING' }),
      }),
    );
    expect(mocks.registerAllProcessors).toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(
      QueueName.CONTENT_PARSE,
      expect.objectContaining({ contentId: 'c1', asyncJobId: 'job_1' }),
    );
  });
  it('rejects a lost atomic state claim without creating or queueing a job', async (): Promise<void> => {
    mocks.update.mockResolvedValueOnce({ count: 0 });
    const response = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(response.status).toBe(409);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
