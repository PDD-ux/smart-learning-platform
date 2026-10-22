import type { LearningContent } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: {
      count: mocks.count,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
  },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET as listGET } from '@/app/api/contents/route';
import { GET as detailGET, PATCH } from '@/app/api/contents/[id]/route';

/**
 * 内容列表 / 详情 / 编辑 路由单测（tasks.md §3.2）
 */

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRow(overrides: Partial<LearningContent> = {}): LearningContent {
  return {
    urlSource: null,
    bookState: null, bookRevision: 0,
    id: 'c1',
    ownerId: 'u1',
    contentType: 'VIDEO',
    title: '第 1 讲',
    description: null,
    fileName: 'lesson.mp4',
    format: 'MP4',
    durationSec: 12,
    pageCount: null,
    fileSizeBytes: BigInt(1024),
    storageKey: 'contents/c1/lesson.mp4',
    coverUrl: null,
    status: 'READY',
    failReason: null,
    understandingStatus: 'NONE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function req(url: string, init: RequestInit = {}, withAuth = true): NextRequest {
  const headers = new Headers(init.headers);
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(url, { method: init.method, body: init.body ?? undefined, headers });
}

describe('GET /api/contents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(1);
    mocks.findMany.mockResolvedValue([makeRow()]);
  });

  it('returns a paginated list', async () => {
    const res = await listGET(req('http://localhost/api/contents'), undefined as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(10);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]).toMatchObject({ contentId: 'c1', contentType: 'video', status: '已就绪' });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'u1' }, skip: 0, take: 10 }),
    );
  });

  it('filters by type', async () => {
    await listGET(req('http://localhost/api/contents?type=document'), undefined as never);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'u1', contentType: 'DOCUMENT' } }),
    );
  });

  it('applies pagination', async () => {
    await listGET(req('http://localhost/api/contents?page=3&pageSize=5'), undefined as never);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 5 }));
  });

  it('rejects an out-of-range pageSize', async () => {
    const res = await listGET(req('http://localhost/api/contents?pageSize=999'), undefined as never);
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await listGET(req('http://localhost/api/contents', {}, false), undefined as never);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/contents/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when missing', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await detailGET(req('http://localhost/api/contents/c1'), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    mocks.findUnique.mockResolvedValue(makeRow({ ownerId: 'other' }));
    const res = await detailGET(req('http://localhost/api/contents/c1'), { params: { id: 'c1' } });
    expect(res.status).toBe(403);
  });

  it('returns the summary for the owner', async () => {
    mocks.findUnique.mockResolvedValue(makeRow());
    const res = await detailGET(req('http://localhost/api/contents/c1'), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.contentId).toBe('c1');
  });
});

describe('PATCH /api/contents/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(makeRow());
    mocks.update.mockResolvedValue(makeRow({ title: '新标题' }));
  });

  it('updates the title and returns the summary', async () => {
    const res = await PATCH(
      req('http://localhost/api/contents/c1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '新标题' }),
      }),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.title).toBe('新标题');
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { title: '新标题' },
    });
  });

  it('rejects an empty title', async () => {
    const res = await PATCH(
      req('http://localhost/api/contents/c1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a payload with no fields', async () => {
    const res = await PATCH(
      req('http://localhost/api/contents/c1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for a non-owner', async () => {
    mocks.findUnique.mockResolvedValue(makeRow({ ownerId: 'other' }));
    const res = await PATCH(
      req('http://localhost/api/contents/c1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      }),
      { params: { id: 'c1' } },
    );
    expect(res.status).toBe(403);
  });
});
