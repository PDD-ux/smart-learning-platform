import type { CardStatus } from '@prisma/client';

/**
 * SM-2 间隔重复核心（tasks.md §7.1）
 * ------------------------------------------------------------
 * 三参数：easeFactor（默认 2.5，区间 [1.3, 3.0]）、intervalDays、repetitions。
 * 状态机：new → learning → review → graduated
 *   - learning：连续 2 次 rating≥2（即 repetitions≥2）转 review；
 *   - review：rating=3 且 interval≥21 天转 graduated；
 *   - 任一 rating<2：重置 repetitions 并回到 learning。
 * 评分：0 忘记 / 1 模糊 / 2 犹豫 / 3 记住。
 *
 * 纯函数，无副作用；作答落库与 review_logs 见 `./review`。
 */

export const DEFAULT_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;
export const MAX_EASE_FACTOR = 3.0;
export const GRADUATE_INTERVAL_DAYS = 21;

export type Rating = 0 | 1 | 2 | 3;

export type Sm2State = {
  status: CardStatus;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
};

export type Sm2Result = Sm2State & {
  /** 下次复习时间（由 intervalDays 推导） */
  nextReviewAt: Date;
};

export function clampEaseFactor(value: number): number {
  return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, value));
}

/** SM-2 易度因子更新（rating 0~3 映射到标准 0~5 质量） */
export function nextEaseFactor(easeFactor: number, rating: Rating): number {
  const delta = 0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02);
  return clampEaseFactor(Number((easeFactor + delta).toFixed(4)));
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/** 依据当前状态与评分推进 SM-2 状态机 */
export function scheduleReview(state: Sm2State, rating: Rating, now: Date = new Date()): Sm2Result {
  let { status, intervalDays, repetitions } = state;
  const easeFactor = nextEaseFactor(state.easeFactor, rating);

  if (rating < 2) {
    // 忘记/模糊：重置到 learning
    status = 'LEARNING';
    repetitions = 0;
    intervalDays = 1;
  } else {
    // 间隔推进：1 天 → 6 天 → interval * easeFactor
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;

    if (status === 'NEW' || status === 'LEARNING') {
      // 首次答对进入 learning；连续 2 次答对（repetitions≥2）转 review
      status = repetitions >= 2 ? 'REVIEW' : 'LEARNING';
    } else if (status === 'REVIEW') {
      if (rating === 3 && intervalDays >= GRADUATE_INTERVAL_DAYS) status = 'GRADUATED';
    }
    // GRADUATED：保持
  }

  return { status, easeFactor, intervalDays, repetitions, nextReviewAt: addDays(now, intervalDays) };
}
