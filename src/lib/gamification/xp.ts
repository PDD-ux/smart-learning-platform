import type { Rating } from '@/lib/domain/sm2';

/**
 * 复习奖励规则（tasks.md §7.5）
 * ------------------------------------------------------------
 * 只负责 XP 与连续答对次数，不修改 SM-2 调度结果。
 */

export const XP_BY_RATING: Record<Rating, number> = {
  0: 0,
  1: 2,
  2: 5,
  3: 10,
};

export function xpGainFor(rating: Rating): number {
  return XP_BY_RATING[rating];
}

export function streakAfter(previousStreak: number, rating: Rating): number {
  if (rating !== 3) return 0;
  return Math.max(0, Math.floor(previousStreak)) + 1;
}

export type ReviewReward = {
  xpGain: number;
  newStreak: number;
};

export function reviewReward(previousStreak: number, rating: Rating): ReviewReward {
  return {
    xpGain: xpGainFor(rating),
    newStreak: streakAfter(previousStreak, rating),
  };
}
