import type { Prisma } from '@prisma/client';

/**
 * 掌握度计算（tasks.md §7.3）
 * ------------------------------------------------------------
 * 每张关联闪卡只取最近一次评分，按时间衰减后求平均；未复习卡按 0 分参与。
 * 有练习记录时，将闪卡得分与练习正确率按 7:3 合并；仅有其中一种来源时直接使用。
 */

export const REVIEW_RECENCY_DECAY_DAYS = 30;
export const FLASHCARD_WEIGHT = 0.7;
export const EXERCISE_WEIGHT = 0.3;
export const WEAK_MASTERY_THRESHOLD = 0.6;

export type ReviewSample = {
  flashcardId: string;
  rating: number;
  reviewedAt: Date;
};

export type MasteryCalculation = {
  flashcardScore: number;
  reviewCount: number;
  correctRate: number | null;
  score: number;
  isWeak: boolean;
};

export type MasteryUpdateResult = MasteryCalculation & {
  learnerId: string;
  pointId: string;
  masteryDelta: number;
};

function round(value: number): number {
  return Number(value.toFixed(4));
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, round(value)));
}

/** 关联闪卡最近评分的近因衰减得分；没有闪卡时为 0。 */
export function calculateFlashcardScore(
  flashcardIds: readonly string[],
  reviews: readonly ReviewSample[],
  now: Date = new Date(),
): number {
  if (flashcardIds.length === 0) return 0;

  const latestReviews = new Map<string, ReviewSample>();
  for (const review of reviews) {
    const current = latestReviews.get(review.flashcardId);
    if (!current || review.reviewedAt > current.reviewedAt) {
      latestReviews.set(review.flashcardId, review);
    }
  }

  const total = flashcardIds.reduce((sum, flashcardId) => {
    const review = latestReviews.get(flashcardId);
    if (!review) return sum;

    const ageDays = Math.max(0, (now.getTime() - review.reviewedAt.getTime()) / 86_400_000);
    const recencyWeight = Math.exp(-ageDays / REVIEW_RECENCY_DECAY_DAYS);
    return sum + (review.rating / 3) * recencyWeight;
  }, 0);

  return clampScore(total / flashcardIds.length);
}

/** 将闪卡得分与练习正确率合并为最终掌握度。 */
export function calculateMastery(
  flashcardScore: number,
  reviewCount: number,
  correctRate: number | null,
): MasteryCalculation {
  const normalizedFlashcardScore = clampScore(flashcardScore);
  const normalizedCorrectRate = correctRate === null ? null : clampScore(correctRate);

  let score = 0;
  if (reviewCount > 0 && normalizedCorrectRate !== null) {
    score = normalizedFlashcardScore * FLASHCARD_WEIGHT + normalizedCorrectRate * EXERCISE_WEIGHT;
  } else if (reviewCount > 0) {
    score = normalizedFlashcardScore;
  } else if (normalizedCorrectRate !== null) {
    score = normalizedCorrectRate;
  }

  const finalScore = clampScore(score);
  return {
    flashcardScore: normalizedFlashcardScore,
    reviewCount,
    correctRate: normalizedCorrectRate,
    score: finalScore,
    isWeak: finalScore < WEAK_MASTERY_THRESHOLD,
  };
}

/**
 * 重算一个学习者在某知识点上的掌握度，并以传入事务 upsert 到 Mastery。
 * §7.2 闪卡评分和后续 §7.4 练习作答均通过此函数回写，保证统一算法。
 */
export async function recalculateMastery(
  tx: Prisma.TransactionClient,
  learnerId: string,
  pointId: string,
  now: Date = new Date(),
): Promise<MasteryUpdateResult> {
  const [cards, exerciseRecords, existing] = await Promise.all([
    tx.flashcard.findMany({
      where: { ownerId: learnerId, pointId },
      select: { id: true },
    }),
    tx.exerciseRecord.findMany({
      where: { learnerId, exercise: { pointId } },
      select: { correct: true },
    }),
    tx.mastery.findUnique({
      where: { learnerId_pointId: { learnerId, pointId } },
      select: { score: true },
    }),
  ]);

  const flashcardIds = cards.map((card) => card.id);
  const reviews = flashcardIds.length === 0
    ? []
    : await tx.reviewLog.findMany({
        where: { flashcardId: { in: flashcardIds } },
        select: { flashcardId: true, rating: true, reviewedAt: true },
      });
  const correctRate = exerciseRecords.length === 0
    ? null
    : exerciseRecords.filter((record) => record.correct).length / exerciseRecords.length;
  const calculation = calculateMastery(
    calculateFlashcardScore(flashcardIds, reviews, now),
    reviews.length,
    correctRate,
  );

  await tx.mastery.upsert({
    where: { learnerId_pointId: { learnerId, pointId } },
    create: {
      learnerId,
      pointId,
      score: calculation.score,
      reviewCount: calculation.reviewCount,
      correctRate: calculation.correctRate,
      isWeak: calculation.isWeak,
    },
    update: {
      score: calculation.score,
      reviewCount: calculation.reviewCount,
      correctRate: calculation.correctRate,
      isWeak: calculation.isWeak,
    },
  });

  return {
    ...calculation,
    learnerId,
    pointId,
    masteryDelta: round(calculation.score - (existing?.score ?? 0)),
  };
}
