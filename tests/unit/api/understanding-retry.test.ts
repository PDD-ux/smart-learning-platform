import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  enqueueUnderstanding: vi.fn(),
  registerAllProcessors: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { learningContent: { findUnique: mocks.findUnique } },
}));

vi.mock('@/lib/jobs/pipeline/understanding-pipeline', () => ({
  enqueueUnderstanding: mocks.enqueueUnderstanding,
}));

vi.mock('@/lib/jobs/workers', () => ({
  registerAllProcessors: mocks.registerAllProcessors,
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { POST } from '@/app/api/contents/[id]/understanding/retry/route';

/**
 * POST /api/contents/:id/understanding/retry 单测（tasks.md §6.2）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/understanding/retry', {
    method: 'POST',
    headers,
  });
}

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    ownerId: 'u1',
    status: 'READY',
    understandingStatus: 'FAILED',
    ...overrides,
  };
}

describe('POST /api/contents/:id/understanding/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(makeContent());
    mocks.enqueueUnderstanding.mockResolvedValue({ jobId: 'j1', traceId: 't1' });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await POST(makeRequest(false), { params: { id: 'c1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the content is missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ ownerId: 'other' }));
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(403);
  });

  it('returns 409 when the content is not ready', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ status: 'PARSING' }));
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONTENT_NOT_READY');
  });

  it('returns 409 when understanding is not in a failed terminal state', async () => {
    mocks.findUnique.mockResolvedValueOnce(makeContent({ understandingStatus: 'RUNNING' }));
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('UNDERSTANDING_RETRY_NOT_ALLOWED');
    expect(mocks.enqueueUnderstanding).not.toHaveBeenCalled();
  });

  it('re-enqueues the pipeline on a failed task', async () => {
    const res = await POST(makeRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ contentId: 'c1', phase: 'light-filter' });
    expect(mocks.registerAllProcessors).toHaveBeenCalled();
    expect(mocks.enqueueUnderstanding).toHaveBeenCalledWith('c1');
  });
});
