import { NextRequest } from 'next/server';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { ACHIEVEMENTS } from '@/lib/gamification/achievements';
import { levelFor } from '@/lib/gamification/level';
import { prisma } from '@/lib/prisma';

/**
 * 游戏化档案（tasks.md §7.5）
 * ------------------------------------------------------------
 * GET /api/gamification/profile
 */

export const GET = withAuth(async (_request: NextRequest, { user }) => {
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      nickname: true,
      role: true,
      xpTotal: true,
      achievements: {
        select: { achievementKey: true, unlockedAt: true },
        orderBy: { unlockedAt: 'asc' },
      },
    },
  });

  if (!profile) {
    return fail(ErrorCode.UNAUTHENTICATED, '学习者不存在', HttpStatus.UNAUTHORIZED);
  }

  const unlockedByKey = new Map(
    profile.achievements.map((achievement) => [achievement.achievementKey, achievement.unlockedAt]),
  );
  return ok({
    nickname: profile.nickname,
    role: profile.role,
    xpTotal: profile.xpTotal,
    currentLevel: levelFor(profile.xpTotal).displayName,
    achievements: ACHIEVEMENTS.map((achievement) => {
      const unlockedAt = unlockedByKey.get(achievement.key);
      return {
        key: achievement.key,
        title: achievement.title,
        unlocked: unlockedAt !== undefined,
        unlockedAt: unlockedAt?.toISOString() ?? null,
      };
    }),
  });
});
