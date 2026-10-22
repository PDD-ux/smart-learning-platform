import type { ReactElement } from 'react';

/**
 * 闪卡复习状态，取值与 `prisma/schema.prisma` 的 `CardStatus` 枚举保持一致。
 *
 * 这里刻意定义成前端本地类型，而不是从 `@prisma/client` 导入：
 * 本文件是客户端组件，按 AGENTS.md 的架构约束不应直接依赖数据库产物。
 * 日后若改动 `CardStatus` 枚举，请记得同步这里的取值。
 */
export type ReviewCardStatus =
  | 'NEW'
  | 'LEARNING'
  | 'REVIEW'
  | 'GRADUATED'
  | 'new'
  | 'learning'
  | 'review'
  | 'graduated';

export type RarityKind = 'hard' | 'confirm' | 'easy' | 'mastered';

export type RarityBadgeProps = {
  kind: RarityKind;
  label: string;
};

export function rarityFor(easeFactor: number, status: ReviewCardStatus | string): RarityKind {
  if (status === 'GRADUATED' || status === 'graduated') return 'mastered';
  if (easeFactor < 1.7) return 'hard';
  if (status.toLowerCase() === 'new' || status.toLowerCase() === 'learning') return 'confirm';
  if (easeFactor < 2.0) return 'confirm';
  return 'easy';
}

const rarityLabels: Record<RarityKind, string> = {
  hard: '困难',
  confirm: '待巩固',
  easy: '熟练',
  mastered: '已掌握',
};

export function rarityLabel(kind: RarityKind, intervalDays?: number): string {
  const suffix = intervalDays === undefined ? '' : ` · 间隔 ${intervalDays} 天`;
  return `${rarityLabels[kind]}${suffix}`;
}

export function RarityBadge({ kind, label }: RarityBadgeProps): ReactElement {
  return (
    <span className={`rarity r-${kind}`} aria-label={`闪卡稀有度：${label}`}>
      {label}
    </span>
  );
}
