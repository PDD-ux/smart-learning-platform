import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ noteCount: vi.fn(), noteFindMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: { note: { count: mocks.noteCount, findMany: mocks.noteFindMany } },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/notes/search/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function request(url: string, authenticated = true): NextRequest {
  const headers = new Headers();
  if (authenticated) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(url, { headers });
}

function makeSearchNote() {
  return {
    id: 'n1',
    ownerId: 'u1',
    contentId: 'c1',
    content: '反向传播使用链式法则',
    ref: { type: 'video', timestampSec: 32 },
    version: 1,
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    updatedAt: new Date('2026-10-02T08:00:00.000Z'),
    lesson: { title: '机器学习基础' },
  };
}

describe('GET /api/notes/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noteCount.mockResolvedValue(1);
    mocks.noteFindMany.mockResolvedValue([makeSearchNote()]);
  });

  it('searches only the current learner notes and returns paged hits with source info', async () => {
    const response = await GET(request('http://localhost/api/notes/search?q=%E9%93%BE%E5%BC%8F&page=2&pageSize=5'));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      page: 2,
      pageSize: 5,
      total: 1,
      items: [{
        noteId: 'n1', content: '反向传播使用链式法则',
        ref: { type: 'video', timestampSec: 32 },
        contentId: 'c1', contentTitle: '机器学习基础',
      }],
    });
    expect(mocks.noteCount).toHaveBeenCalledWith({
      where: { ownerId: 'u1', content: { contains: '链式', mode: 'insensitive' } },
    });
    expect(mocks.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'u1', content: { contains: '链式', mode: 'insensitive' } },
      skip: 5,
      take: 5,
      include: { lesson: { select: { title: true } } },
    }));
  });

  it('rejects missing or whitespace-only queries with QUERY_TOO_SHORT', async () => {
    for (const url of ['http://localhost/api/notes/search', 'http://localhost/api/notes/search?q=%20%20']) {
      const response = await GET(request(url));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('QUERY_TOO_SHORT');
    }
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
  });

  it('rejects invalid pagination parameters', async () => {
    const response = await GET(request('http://localhost/api/notes/search?q=%E7%AC%94%E8%AE%B0&page=0'));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('requires authentication', async () => {
    const response = await GET(request('http://localhost/api/notes/search?q=%E7%AC%94%E8%AE%B0', false));
    expect(response.status).toBe(401);
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
  });
});
