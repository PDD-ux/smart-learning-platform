import { NextRequest } from 'next/server';

import { ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/prisma';

/**
 * 薄弱点清单（tasks.md §7.4）
 * ------------------------------------------------------------
 * GET /api/mastery/weak-points —— 按掌握度升序返回薄弱知识点。
 */

export const GET = withAuth(async (_request: NextRequest, { user }) => {
  const masteries = await prisma.mastery.findMany({
    where: { learnerId: user.id, isWeak: true },
    select: {
      pointId: true,
      score: true,
      point: {
        select: {
          title: true,
          tags: true,
          contentId: true,
          content: { select: { title: true } },
        },
      },
    },
    orderBy: { score: 'asc' },
  });

  const pointIds = masteries.map((mastery) => mastery.pointId);
  if (pointIds.length === 0) return ok({ items: [] });

  const cards = await prisma.flashcard.findMany({
    where: { ownerId: user.id, pointId: { in: pointIds } },
    select: { id: true, pointId: true },
  });
  const cardIds = cards.map((card) => card.id);
  const logs = cardIds.length === 0
    ? []
    : await prisma.reviewLog.findMany({
        where: { flashcardId: { in: cardIds } },
        orderBy: { reviewedAt: 'desc' },
        select: { flashcardId: true, reviewedAt: true },
      });

  const cardPointById = new Map(cards.map((card) => [card.id, card.pointId]));
  const lastReviewByPoint = new Map<string, Date>();
  for (const log of logs) {
    const pointId = cardPointById.get(log.flashcardId);
    if (pointId && !lastReviewByPoint.has(pointId)) {
      lastReviewByPoint.set(pointId, log.reviewedAt);
    }
  }
  const cardCountByPoint = new Map<string, number>();
  for (const card of cards) {
    if (card.pointId) cardCountByPoint.set(card.pointId, (cardCountByPoint.get(card.pointId) ?? 0) + 1);
  }

  return ok({
    items: masteries.map((mastery) => ({
      pointId: mastery.pointId,
      title: mastery.point.title,
      tags: mastery.point.tags,
      score: mastery.score,
      contentId: mastery.point.contentId,
      contentTitle: mastery.point.content.title,
      relatedFlashcardCount: cardCountByPoint.get(mastery.pointId) ?? 0,
      lastReviewAt: lastReviewByPoint.get(mastery.pointId)?.toISOString() ?? null,
    })),
  });
});
