import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';
import { prisma } from '@/lib/prisma';
import { recordCounter } from '@/lib/observability/metrics';

import { checkAndUnlock, type UnlockedAchievement } from '../gamification/achievements';
import { levelFor } from '../gamification/level';
import { reviewReward } from '../gamification/xp';
import { recalculateMastery } from './mastery';
import { scheduleReview, type Rating, type Sm2Result } from './sm2';

/**
 * 闪卡作答（tasks.md §7.1）
 * ------------------------------------------------------------
 * 读取闪卡 SM-2 三参数 → 推进状态机 → 事务内更新闪卡并写 `review_logs`
 * （rating、新旧间隔）。供 §7.2 复习接口复用。
 */

export type ApplyReviewResult = Sm2Result & {
  flashcardId: string;
  prevIntervalDays: number;
  rating: Rating;
  masteryDelta: number;
  xpGain: number;
  newStreak: number;
  newXpTotal: number;
  levelUp: { from: string; to: string } | null;
  unlockedAchievements: UnlockedAchievement[];
};

export async function applyReview(
  flashcardId: string,
  rating: Rating,
  now: Date = new Date(),
): Promise<ApplyReviewResult> {
  const card = await prisma.flashcard.findUnique({ where: { id: flashcardId } });
  if (!card) {
    throw new ApiError(ErrorCode.FLASHCARD_NOT_FOUND, '闪卡不存在');
  }

  const result = scheduleReview(
    {
      status: card.status,
      easeFactor: card.easeFactor,
      intervalDays: card.intervalDays,
      repetitions: card.repetitions,
    },
    rating,
    now,
  );

  let masteryDelta = 0;
  let xpGain = 0;
  let newStreak = 0;
  let newXpTotal = 0;
  let levelUp: { from: string; to: string } | null = null;
  let unlockedAchievements: UnlockedAchievement[] = [];
  await prisma.$transaction(async (tx) => {
    const [latestReview, currentUser] = await Promise.all([
      tx.reviewLog.findFirst({
        where: { flashcard: { ownerId: card.ownerId } },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
        select: { streakAfter: true },
      }),
      tx.user.findUnique({ where: { id: card.ownerId }, select: { xpTotal: true } }),
    ]);
    if (!currentUser) {
      throw new ApiError(ErrorCode.UNAUTHENTICATED, '学习者不存在');
    }

    const reward = reviewReward(latestReview?.streakAfter ?? 0, rating);
    const previousLevel = levelFor(currentUser.xpTotal);
    const updatedUser = await tx.user.update({
      where: { id: card.ownerId },
      data: { xpTotal: { increment: reward.xpGain } },
      select: { xpTotal: true },
    });
    const nextLevel = levelFor(updatedUser.xpTotal);

    await tx.flashcard.update({
      where: { id: flashcardId },
      data: {
        status: result.status,
        easeFactor: result.easeFactor,
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        nextReviewAt: result.nextReviewAt,
      },
    });
    await tx.reviewLog.create({
      data: {
        flashcardId,
        rating,
        prevInterval: card.intervalDays,
        newInterval: result.intervalDays,
        streakAfter: reward.newStreak,
        reviewedAt: now,
      },
    });

    xpGain = reward.xpGain;
    newStreak = reward.newStreak;
    newXpTotal = updatedUser.xpTotal;
    levelUp = previousLevel.level === nextLevel.level
      ? null
      : { from: previousLevel.displayName, to: nextLevel.displayName };
    unlockedAchievements = await checkAndUnlock(
      card.ownerId,
      { streak: newStreak, xpTotal: newXpTotal },
      tx,
    );

    if (card.pointId) {
      const mastery = await recalculateMastery(tx, card.ownerId, card.pointId, now);
      masteryDelta = mastery.masteryDelta;
    }
  });

  recordCounter('slp_flashcard_reviews_total', { rating });

  return {
    ...result,
    flashcardId,
    prevIntervalDays: card.intervalDays,
    rating,
    masteryDelta,
    xpGain,
    newStreak,
    newXpTotal,
    levelUp,
    unlockedAchievements,
  };
}
