import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { cardStatusLabel } from '@/lib/domain/flashcard-mapper';
import { applyReview } from '@/lib/domain/review';
import type { Rating } from '@/lib/domain/sm2';
import { prisma } from '@/lib/prisma';

/**
 * 闪卡作答评分（tasks.md §7.2）
 * ------------------------------------------------------------
 * POST /api/flashcards/:id/review
 * 评分：0 忘记 / 1 模糊 / 2 犹豫 / 3 记住。
 * SM-2 三参数更新与 review_logs 写入由 applyReview 统一负责。
 */

const reviewSchema = z.object({
  rating: z.number().int().min(0).max(3),
});

export const POST = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }) => {
  const card = await prisma.flashcard.findUnique({ where: { id: params.id } });
  if (!card) {
    return fail(ErrorCode.FLASHCARD_NOT_FOUND, '闪卡不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(card.ownerId, user);

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.RATING_INVALID,
      '评分必须是 0 到 3 的整数',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const result = await applyReview(params.id, parsed.data.rating as Rating);
  return ok({
    flashcardId: result.flashcardId,
    newStatus: cardStatusLabel(result.status),
    nextReviewAt: result.nextReviewAt.toISOString(),
    newEaseFactor: result.easeFactor,
    newIntervalDays: result.intervalDays,
    masteryDelta: result.masteryDelta,
    xpGain: result.xpGain,
    newStreak: result.newStreak,
    newXpTotal: result.newXpTotal,
    levelUp: result.levelUp,
    unlockedAchievements: result.unlockedAchievements,
  }, '复习评分已保存');
});
