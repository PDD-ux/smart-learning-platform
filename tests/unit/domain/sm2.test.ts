import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EASE_FACTOR,
  clampEaseFactor,
  nextEaseFactor,
  scheduleReview,
  type Sm2State,
} from '@/lib/domain/sm2';

/**
 * SM-2 调度核心 单测（tasks.md §7.1）
 */

const now = new Date('2026-01-01T00:00:00.000Z');

function newState(): Sm2State {
  return { status: 'NEW', easeFactor: DEFAULT_EASE_FACTOR, intervalDays: 0, repetitions: 0 };
}

describe('clampEaseFactor', () => {
  it('clamps to [1.3, 3.0]', () => {
    expect(clampEaseFactor(1.0)).toBe(1.3);
    expect(clampEaseFactor(5)).toBe(3.0);
    expect(clampEaseFactor(2.5)).toBe(2.5);
  });
});

describe('nextEaseFactor', () => {
  it('adjusts by rating', () => {
    expect(nextEaseFactor(2.5, 3)).toBeCloseTo(2.6);
    expect(nextEaseFactor(2.5, 2)).toBeCloseTo(2.5);
    expect(nextEaseFactor(2.5, 1)).toBeCloseTo(2.36);
    expect(nextEaseFactor(2.5, 0)).toBeCloseTo(2.18);
  });

  it('never drops below the minimum', () => {
    expect(nextEaseFactor(1.3, 0)).toBe(1.3);
  });
});

describe('scheduleReview', () => {
  it('keeps a new card in learning after the first good answer', () => {
    const result = scheduleReview(newState(), 3, now);
    expect(result).toMatchObject({ status: 'LEARNING', repetitions: 1, intervalDays: 1 });
  });

  it('promotes to review after two consecutive good answers', () => {
    const first = scheduleReview(newState(), 3, now);
    const second = scheduleReview(first, 3, now);
    expect(second).toMatchObject({ status: 'REVIEW', repetitions: 2, intervalDays: 6 });
  });

  it('grows the interval by easeFactor from the third success', () => {
    let state = scheduleReview(newState(), 3, now);
    state = scheduleReview(state, 3, now);
    const third = scheduleReview(state, 3, now);
    expect(third.intervalDays).toBe(17); // round(6 * 2.8)
    expect(third.status).toBe('REVIEW');
  });

  it('graduates when rating=3 and interval ≥ 21 days', () => {
    let state = scheduleReview(newState(), 3, now);
    state = scheduleReview(state, 3, now);
    state = scheduleReview(state, 3, now);
    const fourth = scheduleReview(state, 3, now);
    expect(fourth.intervalDays).toBeGreaterThanOrEqual(21);
    expect(fourth.status).toBe('GRADUATED');
  });

  it('resets to learning on a poor rating', () => {
    let state = scheduleReview(newState(), 3, now);
    state = scheduleReview(state, 3, now);
    const failed = scheduleReview(state, 1, now);
    expect(failed).toMatchObject({ status: 'LEARNING', repetitions: 0, intervalDays: 1 });
  });

  it('schedules the next review by interval days', () => {
    const result = scheduleReview(newState(), 3, now);
    expect(result.nextReviewAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
});
