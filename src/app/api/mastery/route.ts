import { NextRequest } from 'next/server';

import { ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/prisma';

/**
 * 掌握度汇总（tasks.md §7.4）
 * ------------------------------------------------------------
 * GET /api/mastery —— 当前学习者全部知识点掌握度，按分数升序返回。
 */

export const GET = withAuth(async (_request: NextRequest, { user }) => {
  const masteries = await prisma.mastery.findMany({
    where: { learnerId: user.id },
    include: { point: { select: { title: true } } },
    orderBy: [{ score: 'asc' }, { updatedAt: 'desc' }],
  });

  return ok({
    items: masteries.map((mastery) => ({
      pointId: mastery.pointId,
      title: mastery.point.title,
      score: mastery.score,
      isWeak: mastery.isWeak,
      reviewCount: mastery.reviewCount,
      correctRate: mastery.correctRate,
    })),
  });
});
