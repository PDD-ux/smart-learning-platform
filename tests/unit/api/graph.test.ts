import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  pointFindMany: vi.fn(),
  edgeFindMany: vi.fn(),
  noteFindMany: vi.fn(),
  flashcardFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.contentFindUnique },
    knowledgePoint: { findMany: mocks.pointFindMany },
    graphEdge: { findMany: mocks.edgeFindMany },
    note: { findMany: mocks.noteFindMany },
    flashcard: { findMany: mocks.flashcardFindMany },
  },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/contents/[id]/graph/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/contents/c1/graph', { headers });
}

describe('GET content graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue({ id: 'c1', ownerId: 'u1' });
    mocks.pointFindMany.mockResolvedValue([
      {
        id: 'p1',
        title: '函数',
        contentId: 'c1',
        refs: [{ type: 'video', timestampSec: 10 }],
        graphNode: { nodeType: 'CONCEPT' },
        masteries: [{ score: 0.75, isWeak: false, reviewCount: 3, correctRate: 0.8 }],
      },
      { id: 'p2', title: '导数', contentId: 'c1', refs: [], graphNode: null, masteries: [] },
    ]);
    mocks.edgeFindMany.mockResolvedValue([
      { sourcePointId: 'p1', targetPointId: 'p2', relation: 'PREREQUISITE', weight: 0.8 },
    ]);
    mocks.noteFindMany.mockResolvedValue([{ contentId: 'c1', ref: { type: 'video', timestampSec: 10 } }]);
    mocks.flashcardFindMany.mockResolvedValue([
      { pointId: 'p1', reviewLogs: [{ reviewedAt: new Date('2026-10-02T10:00:00.000Z') }] },
    ]);
  });

  it('requires authentication', async () => {
    expect((await GET(makeRequest(false), { params: { id: 'c1' } })).status).toBe(401);
    expect(mocks.contentFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when content is missing', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce(null);
    expect((await GET(makeRequest(), { params: { id: 'c1' } })).status).toBe(404);
    expect(mocks.pointFindMany).not.toHaveBeenCalled();
  });

  it('rejects access to another learner’s content', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce({ id: 'c1', ownerId: 'u2' });
    expect((await GET(makeRequest(), { params: { id: 'c1' } })).status).toBe(403);
    expect(mocks.pointFindMany).not.toHaveBeenCalled();
  });

  it('returns nodes, user mastery and content-scoped edges in the API contract', async () => {
    const response = await GET(makeRequest(), { params: { id: 'c1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.nodes).toEqual([
      { pointId: 'p1', title: '函数', nodeType: 'concept', mastery: 0.75, isWeak: false, reviewCount: 3, correctRate: 0.8, relatedNoteCount: 1, relatedFlashcardCount: 1, lastReviewedAt: '2026-10-02T10:00:00.000Z' },
      { pointId: 'p2', title: '导数', nodeType: 'concept', mastery: 0, isWeak: false, reviewCount: 0, correctRate: null, relatedNoteCount: 0, relatedFlashcardCount: 0, lastReviewedAt: null },
    ]);
    expect(body.data.edges).toEqual([
      { source: 'p1', target: 'p2', relation: 'prerequisite', weight: 0.8 },
    ]);
    expect(mocks.pointFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contentId: 'c1' },
      select: expect.objectContaining({
        masteries: expect.objectContaining({ where: { learnerId: 'u1' } }),
      }),
    }));
    expect(mocks.edgeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contentId: 'c1',
        sourcePointId: { in: ['p1', 'p2'] },
        targetPointId: { in: ['p1', 'p2'] },
      },
    }));
    expect(mocks.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1', contentId: 'c1' } }));
    expect(mocks.flashcardFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1', pointId: { in: ['p1', 'p2'] } } }));
  });

  it('returns empty arrays without querying edges when there are no points', async () => {
    mocks.pointFindMany.mockResolvedValueOnce([]);
    const body = await (await GET(makeRequest(), { params: { id: 'c1' } })).json();
    expect(body.data).toEqual({ nodes: [], edges: [] });
    expect(mocks.edgeFindMany).not.toHaveBeenCalled();
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
    expect(mocks.flashcardFindMany).not.toHaveBeenCalled();
  });
});
