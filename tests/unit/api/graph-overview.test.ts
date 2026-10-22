import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindMany: vi.fn(),
  pointFindMany: vi.fn(),
  edgeFindMany: vi.fn(),
  noteFindMany: vi.fn(),
  flashcardFindMany: vi.fn(),
  practiceFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findMany: mocks.contentFindMany },
    knowledgePoint: { findMany: mocks.pointFindMany },
    graphEdge: { findMany: mocks.edgeFindMany },
    note: { findMany: mocks.noteFindMany },
    flashcard: { findMany: mocks.flashcardFindMany },
    exerciseRecord: { findMany: mocks.practiceFindMany },
  },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/graph/overview/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/graph/overview', { headers });
}

describe('GET graph overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    mocks.pointFindMany.mockResolvedValue([
      {
        id: 'p1',
        title: '函数',
        contentId: 'c1',
        refs: [{ type: 'video', timestampSec: 10 }],
        graphNode: { nodeType: 'CONCEPT', aliases: [] },
        masteries: [{ score: 0.8, isWeak: false, reviewCount: 2, correctRate: 0.9 }],
      },
      {
        id: 'p2',
        title: '函数',
        contentId: 'c2',
        refs: [{ type: 'video', timestampSec: 20 }],
        graphNode: { nodeType: 'CONCEPT', aliases: ['函数关系'] },
        masteries: [{ score: 0.4, isWeak: true, reviewCount: 1, correctRate: 0 }],
      },
      {
        id: 'p3',
        title: '函数',
        contentId: 'c1',
        refs: [],
        graphNode: { nodeType: 'FORMULA', aliases: [] },
        masteries: [],
      },
      {
        id: 'p4',
        title: '导数',
        contentId: 'c1',
        refs: [{ type: 'document', page: 4 }],
        graphNode: null,
        masteries: [],
      },
    ]);
    mocks.edgeFindMany.mockResolvedValue([
      { sourcePointId: 'p1', targetPointId: 'p4', relation: 'RELATED', weight: 0.6, contentId: 'c1' },
      { sourcePointId: 'p2', targetPointId: 'p4', relation: 'RELATED', weight: 0.8, contentId: 'c2' },
      { sourcePointId: 'p1', targetPointId: 'p2', relation: 'RELATED', weight: 1, contentId: 'c1' },
    ]);
    mocks.noteFindMany.mockResolvedValue([{ contentId: 'c1', ref: { type: 'video', timestampSec: 10 } }]);
    mocks.flashcardFindMany.mockResolvedValue([
      { pointId: 'p1', reviewLogs: [{ reviewedAt: new Date('2026-10-01T10:00:00.000Z') }] },
      { pointId: 'p2', reviewLogs: [{ reviewedAt: new Date('2026-10-02T10:00:00.000Z') }] },
    ]);
    mocks.practiceFindMany.mockResolvedValue([
      ...Array.from({ length: 9 }, () => ({ correct: true, exercise: { pointId: 'p1' } })),
      { correct: false, exercise: { pointId: 'p1' } },
      { correct: false, exercise: { pointId: 'p2' } },
      { correct: false, exercise: { pointId: 'p2' } },
    ]);
  });

  it('requires authentication before reading any graph data', async () => {
    expect((await GET(makeRequest(false))).status).toBe(401);
    expect(mocks.contentFindMany).not.toHaveBeenCalled();
  });

  it('returns an empty overview when the learner owns no content', async () => {
    mocks.contentFindMany.mockResolvedValueOnce([]);
    const body = await (await GET(makeRequest())).json();
    expect(body.data).toEqual({
      nodes: [],
      edges: [],
      summary: { contentCount: 0, nodeCount: 0, weakPointCount: 0, edgeCount: 0 },
    });
    expect(mocks.pointFindMany).not.toHaveBeenCalled();
    expect(mocks.edgeFindMany).not.toHaveBeenCalled();
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
    expect(mocks.flashcardFindMany).not.toHaveBeenCalled();
  });

  it('merges matching concepts across owned contents and aggregates weak points', async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.nodes).toEqual(expect.arrayContaining([
      {
        pointId: 'p1',
        title: '函数',
        nodeType: 'concept',
        pointIds: ['p1', 'p2'],
        contentIds: ['c1', 'c2'],
        aliases: ['函数关系'],
        mastery: 0.6,
        isWeak: true,
        weakPointCount: 1,
        reviewCount: 3,
        correctRate: 0.75,
        relatedNoteCount: 1,
        relatedFlashcardCount: 2,
        lastReviewedAt: '2026-10-02T10:00:00.000Z',
      },
      {
        pointId: 'p3',
        title: '函数',
        nodeType: 'formula',
        pointIds: ['p3'],
        contentIds: ['c1'],
        aliases: [],
        mastery: 0,
        isWeak: false,
        weakPointCount: 0,
        reviewCount: 0,
        correctRate: null,
        relatedNoteCount: 0,
        relatedFlashcardCount: 0,
        lastReviewedAt: null,
      },
      {
        pointId: 'p4',
        title: '导数',
        nodeType: 'concept',
        pointIds: ['p4'],
        contentIds: ['c1'],
        aliases: [],
        mastery: 0,
        isWeak: false,
        weakPointCount: 0,
        reviewCount: 0,
        correctRate: null,
        relatedNoteCount: 0,
        relatedFlashcardCount: 0,
        lastReviewedAt: null,
      },
    ]));
    expect(body.data.edges).toEqual([
      {
        source: 'p1',
        target: 'p4',
        relation: 'related',
        contentIds: ['c1', 'c2'],
        weight: 0.7,
      },
    ]);
    expect(body.data.summary).toEqual({ contentCount: 2, nodeCount: 3, weakPointCount: 1, edgeCount: 1 });
    expect(mocks.contentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'u1' },
    }));
    expect(mocks.pointFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contentId: { in: ['c1', 'c2'] } },
      select: expect.objectContaining({
        masteries: expect.objectContaining({ where: { learnerId: 'u1' } }),
      }),
    }));
    expect(mocks.edgeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contentId: { in: ['c1', 'c2'] },
        sourcePointId: { in: ['p1', 'p2', 'p3', 'p4'] },
        targetPointId: { in: ['p1', 'p2', 'p3', 'p4'] },
      },
    }));
    expect(mocks.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1', contentId: { in: ['c1', 'c2'] } } }));
    expect(mocks.flashcardFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1', pointId: { in: ['p1', 'p2', 'p3', 'p4'] } } }));
    expect(mocks.practiceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { learnerId: 'u1', exercise: { contentId: { in: ['c1', 'c2'] }, pointId: { in: ['p1', 'p2', 'p3', 'p4'] } } } }));
  });

  it.each([true, false])('preserves exercise-only history including zero accuracy (%s)', async (correct) => {
    mocks.pointFindMany.mockResolvedValueOnce([{ id: 'p', title: '仅练习', contentId: 'c1', refs: [], graphNode: null, masteries: [{ score: correct ? 1 : 0, isWeak: !correct, reviewCount: 0, correctRate: correct ? 1 : 0 }] }]);
    mocks.flashcardFindMany.mockResolvedValueOnce([]);
    mocks.practiceFindMany.mockResolvedValueOnce([{ correct, exercise: { pointId: 'p' } }]);
    const body = await (await GET(makeRequest())).json();
    expect(body.data.nodes[0]).toMatchObject({ title: '仅练习', reviewCount: 0, correctRate: correct ? 1 : 0, lastReviewedAt: null });
  });

  it('does not invent practice accuracy from reviews or missing exercise records', async () => {
    mocks.practiceFindMany.mockResolvedValueOnce([]);
    const body = await (await GET(makeRequest())).json();
    expect(body.data.nodes.find((node: { pointId: string }) => node.pointId === 'p1')).toMatchObject({ reviewCount: 3, correctRate: null });
  });

  it('returns no edges and zero weak points when the learner has no knowledge points', async () => {
    mocks.pointFindMany.mockResolvedValueOnce([]);
    const body = await (await GET(makeRequest())).json();
    expect(body.data.nodes).toEqual([]);
    expect(body.data.edges).toEqual([]);
    expect(body.data.summary).toEqual({ contentCount: 2, nodeCount: 0, weakPointCount: 0, edgeCount: 0 });
    expect(mocks.edgeFindMany).not.toHaveBeenCalled();
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
    expect(mocks.flashcardFindMany).not.toHaveBeenCalled();
    expect(mocks.practiceFindMany).not.toHaveBeenCalled();
  });
});
