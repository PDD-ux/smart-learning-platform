import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * 复习成就定义与幂等解锁（tasks.md §7.5）
 */

export const ACHIEVEMENTS = [
  {
    key: 'STREAK_3',
    title: '连续答对 3 张闪卡！',
    description: '火焰初燃',
    icon: '🔥',
  },
  {
    key: 'STREAK_7',
    title: '连续答对 7 张 · 火力全开！',
    description: '保持你的答题节奏',
    icon: '🔥',
  },
  {
    key: 'STREAK_10',
    title: '连续答对 10 张 · 无敌！',
    description: '连续专注带来稳定掌握',
    icon: '⚡',
  },
  {
    key: 'XP_100',
    title: '累计 100 XP · 进阶！',
    description: '完成第一段成长旅程',
    icon: '🏆',
  },
  {
    key: 'XP_300',
    title: '累计 300 XP · 高手！',
    description: '学习节奏已经稳定',
    icon: '🏆',
  },
  {
    key: 'XP_500',
    title: '累计 500 XP · 大师！',
    description: '持续复习，形成长期记忆',
    icon: '💎',
  },
] as const;

export type AchievementDefinition = (typeof ACHIEVEMENTS)[number];
export type AchievementKey = AchievementDefinition['key'];

export type AchievementContext = {
  streak: number;
  xpTotal: number;
};

export type UnlockedAchievement = Pick<AchievementDefinition, 'key' | 'title'>;

export type GamificationDb = Pick<Prisma.TransactionClient, 'userAchievement'>;

function qualifies(achievement: AchievementDefinition, context: AchievementContext): boolean {
  if (achievement.key.startsWith('STREAK_')) {
    const threshold = Number(achievement.key.slice('STREAK_'.length));
    return context.streak >= threshold;
  }
  const threshold = Number(achievement.key.slice('XP_'.length));
  return context.xpTotal >= threshold;
}

/**
 * 按唯一索引幂等写入达到条件的成就，只返回本次实际新解锁的成就。
 * 传入事务客户端时，成就写入与闪卡评分、XP 更新保持原子性。
 */
export async function checkAndUnlock(
  userId: string,
  context: AchievementContext,
  db: GamificationDb = prisma,
): Promise<UnlockedAchievement[]> {
  const candidates = ACHIEVEMENTS.filter((achievement) => qualifies(achievement, context));
  if (candidates.length === 0) return [];

  const existing = await db.userAchievement.findMany({
    where: {
      userId,
      achievementKey: { in: candidates.map((achievement) => achievement.key) },
    },
    select: { achievementKey: true },
  });
  const existingKeys = new Set(existing.map((achievement) => achievement.achievementKey));
  const newlyUnlocked = candidates.filter((achievement) => !existingKeys.has(achievement.key));
  if (newlyUnlocked.length === 0) return [];

  await db.userAchievement.createMany({
    data: newlyUnlocked.map((achievement) => ({
      userId,
      achievementKey: achievement.key,
    })),
    skipDuplicates: true,
  });

  return newlyUnlocked.map(({ key, title }) => ({ key, title }));
}
