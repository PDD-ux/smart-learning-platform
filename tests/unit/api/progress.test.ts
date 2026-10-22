import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  progressUpsert: vi.fn(),
  progressFindUnique: vi.fn(),
  redisSet: vi.fn(),
  redisGet: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.contentFindUnique },
    learningProgress: { upsert: mocks.progressUpsert, findUnique: mocks.progressFindUnique },
  },
}));

vi.mock('@/lib/redis', () => ({
  getRedis: () => ({ set: mocks.redisSet, get: mocks.redisGet }),
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET, PUT } from '@/app/api/contents/[id]/progress/route';

/**
 * 学习进度 单测（tasks.md §4.3）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function req(init: RequestInit = {}, withAuth = true): NextRequest {
  const headers = new Headers(init.headers);
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/progress', {
    method: init.method,
    body: init.body ?? undefined,
    headers,
  });
}

function jsonBody(body: unknown, method = 'PUT'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    ownerId: 'u1',
    contentType: 'VIDEO',
    status: 'READY',
    durationSec: 120,
    pageCount: null,
    ...overrides,
  };
}

describe('PUT /api/contents/:id/progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue(makeContent());
    mocks.redisSet.mockResolvedValue('OK');
    mocks.progressUpsert.mockResolvedValue({});
  });

  it('caches progress in redis and flushes to the database', async () => {
    const res = await PUT(req(jsonBody({ contentType: 'video', positionSec: 42 })), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ contentType: 'video', positionSec: 42 });
    expect(body.data.lastStudiedAt).toEqual(expect.any(String));
    expect(mocks.redisSet).toHaveBeenCalledWith(
      'progress:u1:c1',
      expect.any(String),
      'EX',
      300,
    );
    expect(mocks.progressUpsert).toHaveBeenCalled();
  });

  it('falls back to a synchronous db write when redis is unavailable', async () => {
    mocks.redisSet.mockRejectedValueOnce(new Error('redis down'));
    const res = await PUT(req(jsonBody({ contentType: 'video', positionSec: 5 })), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect(mocks.progressUpsert).toHaveBeenCalled();
  });

  it('rejects progress beyond the content duration', async () => {
    const res = await PUT(req(jsonBody({ contentType: 'video', positionSec: 999 })), { params: { id: 'c1' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('REF_OUT_OF_RANGE');
    expect(mocks.progressUpsert).not.toHaveBeenCalled();
  });

  it('rejects a progress type that does not match the content', async () => {
    const res = await PUT(
      req(jsonBody({ contentType: 'document', page: 1, scrollRatio: 0.5 })),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('REF_OUT_OF_RANGE');
  });

  it('returns 404 when the content is missing', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce(null);
    const res = await PUT(req(jsonBody({ contentType: 'video', positionSec: 1 })), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/contents/:id/progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue(makeContent());
  });

  it('returns the cached snapshot when present', async () => {
    mocks.redisGet.mockResolvedValueOnce(
      JSON.stringify({ ref: { type: 'video', positionSec: 33 }, lastStudiedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const res = await GET(req({}, true), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      contentType: 'video',
      positionSec: 33,
      lastStudiedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('falls back to the database on a cache miss', async () => {
    mocks.redisGet.mockResolvedValueOnce(null);
    mocks.progressFindUnique.mockResolvedValueOnce({
      ref: { type: 'video', positionSec: 8 },
      lastStudiedAt: new Date('2026-02-02T00:00:00.000Z'),
    });
    const res = await GET(req(), { params: { id: 'c1' } });
    expect((await res.json()).data.positionSec).toBe(8);
  });

  it('returns a default snapshot when no progress exists', async () => {
    mocks.redisGet.mockResolvedValueOnce(null);
    mocks.progressFindUnique.mockResolvedValueOnce(null);
    const res = await GET(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      contentType: 'video',
      positionSec: 0,
      lastStudiedAt: null,
    });
  });

  it('returns 404 when the content is missing', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce(null);
    const res = await GET(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });
});
