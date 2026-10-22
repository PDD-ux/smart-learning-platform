import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  createLog: vi.fn(),
  findLatestLog: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  findAchievements: vi.fn(),
  createAchievements: vi.fn(),
  recalculateMastery: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    flashcard: { findUnique: mocks.findUnique },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        flashcard: { update: mocks.update },
        reviewLog: { create: mocks.createLog, findFirst: mocks.findLatestLog },
        user: { findUnique: mocks.findUser, update: mocks.updateUser },
        userAchievement: { findMany: mocks.findAchievements, createMany: mocks.createAchievements },
      }),
  },
}));

vi.mock('@/lib/domain/mastery', () => ({
  recalculateMastery: mocks.recalculateMastery,
}));

import { applyReview } from '@/lib/domain/review';
import { ApiError } from '@/lib/auth/ownership';

/**
 * 闪卡作答落库 单测（tasks.md §7.1）
 */

const now = new Date('2026-01-01T00:00:00.000Z');

describe('applyReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: 'f1',
      status: 'NEW',
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      ownerId: 'u1',
      pointId: 'p1',
    });
    mocks.update.mockResolvedValue({});
    mocks.createLog.mockResolvedValue({});
    mocks.findLatestLog.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ xpTotal: 95 });
    mocks.updateUser.mockResolvedValue({ xpTotal: 105 });
    mocks.findAchievements.mockResolvedValue([]);
    mocks.createAchievements.mockResolvedValue({ count: 1 });
    mocks.recalculateMastery.mockResolvedValue({ masteryDelta: 0.3333 });
  });

  it('updates the card and writes a review log', async () => {
    const result = await applyReview('f1', 3, now);

    expect(result).toMatchObject({
      status: 'LEARNING',
      repetitions: 1,
      prevIntervalDays: 0,
      masteryDelta: 0.3333,
      xpGain: 10,
      newStreak: 1,
      newXpTotal: 105,
      levelUp: { from: 'Lv.1 · 新手', to: 'Lv.2 · 进阶' },
      unlockedAchievements: [{ key: 'XP_100', title: '累计 100 XP · 进阶！' }],
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: expect.objectContaining({ status: 'LEARNING', repetitions: 1, intervalDays: 1 }),
    });
    expect(mocks.createLog).toHaveBeenCalledWith({
      data: { flashcardId: 'f1', rating: 3, prevInterval: 0, newInterval: 1, streakAfter: 1, reviewedAt: now },
    });
    expect(mocks.recalculateMastery).toHaveBeenCalledWith(expect.anything(), 'u1', 'p1', now);
  });

  it('throws FLASHCARD_NOT_FOUND when the card is missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(applyReview('missing', 3, now)).rejects.toBeInstanceOf(ApiError);
  });
});
