import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flashcardCount: vi.fn(),
  flashcardFindMany: vi.fn(),
  flashcardFindUnique: vi.fn(),
  applyReview: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    flashcard: {
      count: mocks.flashcardCount,
      findMany: mocks.flashcardFindMany,
      findUnique: mocks.flashcardFindUnique,
    },
    $transaction: (queries: unknown[]) => Promise.all(queries as Promise<unknown>[]),
  },
}));

vi.mock('@/lib/domain/review', () => ({
  applyReview: mocks.applyReview,
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/flashcards/route';
import { POST } from '@/app/api/flashcards/[id]/review/route';

const token = signAccessToken({ sub: 'u1', email: 'a@b.com', role: 'student' });

function req(url: string, init: RequestInit = {}, withAuth = true): NextRequest {
  const headers = new Headers(init.headers);
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(url, {
    method: init.method,
    body: init.body ?? undefined,
    headers,
  });
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    contentId: 'c1',
    ownerId: 'u1',
    pointId: 'p1',
    cardType: 'QA',
    front: '问题',
    back: '答案',
    hint: null,
    status: 'NEW',
    easeFactor: 2.5,
    intervalDays: 0,
    repetitions: 0,
    nextReviewAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('GET /api/flashcards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flashcardCount.mockResolvedValue(1);
    mocks.flashcardFindMany.mockResolvedValue([makeCard()]);
  });

  it('returns only the current user cards with mapped DTO fields', async () => {
    const res = await GET(req('http://localhost/api/flashcards?contentId=c1'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items[0]).toEqual({
      flashcardId: 'f1',
      contentId: 'c1',
      pointId: 'p1',
      contentTitle: null,
      pointTitle: null,
      cardType: 'qa',
      front: '问题',
      back: '答案',
      hint: null,
      status: 'new',
      nextReviewAt: '2026-01-01T00:00:00.000Z',
      easeFactor: 2.5,
      intervalDays: 0,
    });
    expect(mocks.flashcardFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'u1', contentId: 'c1', content: { ownerId: 'u1' } },
    }));
  });

  it('adds due filters when due=true', async () => {
    const res = await GET(req('http://localhost/api/flashcards?due=true'), {});
    expect(res.status).toBe(200);
    expect(mocks.flashcardFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerId: 'u1',
        status: { in: ['NEW', 'LEARNING', 'REVIEW'] },
        nextReviewAt: { lte: expect.any(Date) },
      }),
    }));
  });

  it('returns actual course/point titles and refuses mismatched point metadata', async (): Promise<void> => {
    mocks.flashcardFindMany.mockResolvedValue([makeCard({ content: { title: '课程' }, point: { title: '知识点', ownerId: 'u1', contentId: 'c1' } })]);
    const response = await GET(req('http://localhost/api/flashcards'), {});
    expect((await response.json()).data.items[0]).toMatchObject({ contentTitle: '课程', pointTitle: '知识点' });
    for (const point of [{ title: '外人秘密', ownerId: 'other', contentId: 'c1' }, { title: '其它资料', ownerId: 'u1', contentId: 'other' }]) {
      mocks.flashcardFindMany.mockResolvedValue([makeCard({ point })]);
      expect((await (await GET(req('http://localhost/api/flashcards'), {})).json()).data.items[0].pointTitle).toBeNull();
    }
  });

  it('rejects malformed query parameters', async () => {
    const res = await GET(req('http://localhost/api/flashcards?due=maybe'), {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/flashcards/:id/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flashcardFindUnique.mockResolvedValue(makeCard());
    mocks.applyReview.mockResolvedValue({
      flashcardId: 'f1',
      status: 'LEARNING',
      easeFactor: 2.6,
      intervalDays: 1,
      repetitions: 1,
      nextReviewAt: new Date('2026-01-02T00:00:00.000Z'),
      prevIntervalDays: 0,
      rating: 3,
      masteryDelta: 0.3333,
      xpGain: 10,
      newStreak: 1,
      newXpTotal: 105,
      levelUp: { from: 'Lv.1 · 新手', to: 'Lv.2 · 进阶' },
      unlockedAchievements: [{ key: 'XP_100', title: '累计 100 XP · 进阶！' }],
    });
  });

  it('validates ownership and returns the SM-2 result', async () => {
    const res = await POST(
      req('http://localhost/api/flashcards/f1/review', jsonInit({ rating: 3 })),
      { params: { id: 'f1' } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      flashcardId: 'f1',
      newStatus: 'learning',
      nextReviewAt: '2026-01-02T00:00:00.000Z',
      newEaseFactor: 2.6,
      newIntervalDays: 1,
      masteryDelta: 0.3333,
      xpGain: 10,
      newStreak: 1,
      newXpTotal: 105,
      levelUp: { from: 'Lv.1 · 新手', to: 'Lv.2 · 进阶' },
      unlockedAchievements: [{ key: 'XP_100', title: '累计 100 XP · 进阶！' }],
    });
    expect(mocks.applyReview).toHaveBeenCalledWith('f1', 3);
  });

  it('returns RATING_INVALID for a rating outside 0-3', async () => {
    const res = await POST(
      req('http://localhost/api/flashcards/f1/review', jsonInit({ rating: 4 })),
      { params: { id: 'f1' } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('RATING_INVALID');
    expect(mocks.applyReview).not.toHaveBeenCalled();
  });

  it('returns 403 for a card owned by another user', async () => {
    mocks.flashcardFindUnique.mockResolvedValueOnce(makeCard({ ownerId: 'other' }));
    const res = await POST(
      req('http://localhost/api/flashcards/f1/review', jsonInit({ rating: 3 })),
      { params: { id: 'f1' } },
    );
    expect(res.status).toBe(403);
    expect(mocks.applyReview).not.toHaveBeenCalled();
  });

  it('returns 404 when the card does not exist', async () => {
    mocks.flashcardFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      req('http://localhost/api/flashcards/missing/review', jsonInit({ rating: 3 })),
      { params: { id: 'missing' } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('FLASHCARD_NOT_FOUND');
  });
});
