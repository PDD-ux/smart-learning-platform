import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENTS, type GamificationDb, checkAndUnlock } from '@/lib/gamification/achievements';
import { levelFor } from '@/lib/gamification/level';
import { reviewReward, streakAfter, xpGainFor } from '@/lib/gamification/xp';

describe('levelFor', () => {
  it.each([
    [0, 'Lv.1 · 新手'],
    [99, 'Lv.1 · 新手'],
    [100, 'Lv.2 · 进阶'],
    [300, 'Lv.3 · 高手'],
    [600, 'Lv.4 · 大师'],
    [1000, 'Lv.5 · 学神'],
  ])('returns the expected level at %d XP', (xp, displayName) => {
    expect(levelFor(xp).displayName).toBe(displayName);
  });

  it('clamps negative and non-finite XP to the beginner level', () => {
    expect(levelFor(-10).level).toBe(1);
    expect(levelFor(Number.NaN).level).toBe(1);
  });
});

describe('review rewards', () => {
  it.each([
    [0, 0],
    [1, 2],
    [2, 5],
    [3, 10],
  ])('maps rating %d to %d XP', (rating, expected) => {
    expect(xpGainFor(rating as 0 | 1 | 2 | 3)).toBe(expected);
  });

  it('increments streak only for rating 3 and resets it otherwise', () => {
    expect(streakAfter(2, 3)).toBe(3);
    expect(streakAfter(2, 2)).toBe(0);
    expect(reviewReward(4, 3)).toEqual({ xpGain: 10, newStreak: 5 });
  });
});

describe('checkAndUnlock', () => {
  const findMany = vi.fn();
  const createMany = vi.fn();
  const db = { userAchievement: { findMany, createMany } } as unknown as GamificationDb;

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    createMany.mockResolvedValue({ count: 2 });
  });

  it('unlocks streak and XP achievements once', async () => {
    const unlocked = await checkAndUnlock('u1', { streak: 3, xpTotal: 100 }, db);

    expect(unlocked).toEqual([
      { key: 'STREAK_3', title: '连续答对 3 张闪卡！' },
      { key: 'XP_100', title: '累计 100 XP · 进阶！' },
    ]);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'u1', achievementKey: 'STREAK_3' },
        { userId: 'u1', achievementKey: 'XP_100' },
      ],
      skipDuplicates: true,
    });
  });

  it('does not create achievements that are already unlocked', async () => {
    findMany.mockResolvedValue(ACHIEVEMENTS.map(({ key }) => ({ achievementKey: key })));

    await expect(checkAndUnlock('u1', { streak: 10, xpTotal: 500 }, db)).resolves.toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });
});
