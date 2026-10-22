/**
 * 轻游戏化等级规则（tasks.md §7.5）
 * ------------------------------------------------------------
 * 等级只读取累计 XP，不参与 SM-2 或掌握度计算。
 */

export const LEVELS = [
  { level: 1, minXp: 0, title: '新手', displayName: 'Lv.1 · 新手' },
  { level: 2, minXp: 100, title: '进阶', displayName: 'Lv.2 · 进阶' },
  { level: 3, minXp: 300, title: '高手', displayName: 'Lv.3 · 高手' },
  { level: 4, minXp: 600, title: '大师', displayName: 'Lv.4 · 大师' },
  { level: 5, minXp: 1000, title: '学神', displayName: 'Lv.5 · 学神' },
] as const;

export type LevelInfo = (typeof LEVELS)[number];

export function levelFor(xp: number): LevelInfo {
  const normalizedXp = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let current: LevelInfo = LEVELS[0];
  for (const level of LEVELS) {
    if (level.minXp > normalizedXp) break;
    current = level;
  }
  return current;
}
