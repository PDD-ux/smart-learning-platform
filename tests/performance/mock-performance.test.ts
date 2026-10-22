import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { InferenceGateway, type FrameInput } from '@/lib/ai/gateway';
import { DEFAULT_EASE_FACTOR, scheduleReview, type Rating, type Sm2State } from '@/lib/domain/sm2';

const LEARNER_COUNT = 100;
const FRAME_COUNT = 24;
const MOCK_INFERENCE_PER_FRAME_LIMIT_MS = 200;

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function initialReviewState(): Sm2State {
  return {
    status: 'NEW',
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 0,
    repetitions: 0,
  };
}

function makeFrames(): FrameInput[] {
  return Array.from({ length: FRAME_COUNT }, (_, index) => ({
    frameIndex: index,
    timestampMs: index * 2_000,
    imageBase64: 'AAAA',
  }));
}

describe('§10.4 Mock performance baseline', () => {
  it('schedules 100 concurrent learner review calculations without failures', async () => {
    const ratings: Rating[] = [0, 1, 2, 3];
    const startedAt = performance.now();
    const results = await Promise.all(
      Array.from({ length: LEARNER_COUNT }, (_, index) =>
        Promise.resolve().then(() => scheduleReview(initialReviewState(), ratings[index % ratings.length])),
      ),
    );

    const durationMs = performance.now() - startedAt;
    console.info(`[perf] mock-review: learners=${LEARNER_COUNT} totalMs=${durationMs.toFixed(2)}`);
    expect(results).toHaveLength(LEARNER_COUNT);
    expect(results.every((result) => result.nextReviewAt instanceof Date)).toBe(true);
    expect(durationMs).toBeLessThan(1_000);
  });

  it('keeps the mock first-screen inference path below 200ms per frame at P95', async () => {
    const gateway = new InferenceGateway();
    const frames = makeFrames();
    const durations = await Promise.all(
      Array.from({ length: LEARNER_COUNT }, async () => {
        const startedAt = performance.now();
        const [classified, detected, selected] = await Promise.all([
          gateway.classify(frames, { forceMock: true }),
          gateway.detectText(frames, { forceMock: true }),
          gateway.selectFrames(frames, { forceMock: true }),
        ]);
        expect(classified.items).toHaveLength(FRAME_COUNT);
        expect(detected.items).toHaveLength(FRAME_COUNT);
        expect(selected.frames).toHaveLength(FRAME_COUNT);
        return (performance.now() - startedAt) / FRAME_COUNT;
      }),
    );

    const p95MsPerFrame = percentile(durations, 0.95);
    console.info(
      `[perf] mock-inference: learners=${LEARNER_COUNT} frames=${FRAME_COUNT} p95MsPerFrame=${p95MsPerFrame.toFixed(4)}`,
    );
    expect(p95MsPerFrame).toBeLessThan(MOCK_INFERENCE_PER_FRAME_LIMIT_MS);
  });
});
