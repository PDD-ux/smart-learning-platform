import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  calculateFlashcardScore,
  calculateMastery,
  recalculateMastery,
} from '@/lib/domain/mastery';

const now = new Date('2026-01-31T00:00:00.000Z');

describe('mastery calculation', () => {
  it('uses each flashcard latest review and applies recency decay', () => {
    const score = calculateFlashcardScore(
      ['f1', 'f2'],
      [
        { flashcardId: 'f1', rating: 0, reviewedAt: new Date('2026-01-01T00:00:00.000Z') },
        { flashcardId: 'f1', rating: 3, reviewedAt: now },
        { flashcardId: 'f2', rating: 3, reviewedAt: new Date('2026-01-01T00:00:00.000Z') },
      ],
      now,
    );

    expect(score).toBeCloseTo(0.684, 3);
  });

  it('combines review score and exercise correct rate only when both exist', () => {
    expect(calculateMastery(0.5, 2, 1)).toMatchObject({ score: 0.65, isWeak: false });
    expect(calculateMastery(0.5, 2, null)).toMatchObject({ score: 0.5, isWeak: true });
    expect(calculateMastery(0, 0, 0.8)).toMatchObject({ score: 0.8, isWeak: false });
  });

  it('upserts Mastery and reports score delta', async () => {
    const tx = {
      flashcard: { findMany: vi.fn().mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]) },
      reviewLog: {
        findMany: vi.fn().mockResolvedValue([
          { flashcardId: 'f1', rating: 3, reviewedAt: now },
        ]),
      },
      exerciseRecord: { findMany: vi.fn().mockResolvedValue([{ correct: true }, { correct: false }]) },
      mastery: {
        findUnique: vi.fn().mockResolvedValue({ score: 0.4 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;

    const result = await recalculateMastery(tx, 'u1', 'p1', now);

    expect(result).toMatchObject({ score: 0.5, reviewCount: 1, correctRate: 0.5, isWeak: true, masteryDelta: 0.1 });
    expect(tx.mastery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ learnerId: 'u1', pointId: 'p1', isWeak: true }),
    }));
  });
});
