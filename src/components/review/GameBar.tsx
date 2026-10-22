'use client';

import type { ReactElement } from 'react';

export type GameBarProps = {
  streak: number;
  xp: number;
  level: string;
  todayProgress: { done: number; total: number };
};

export type StatPillProps = {
  kind: 'streak' | 'xp' | 'today';
  num: number | string;
  label: string;
  active?: boolean;
};

const statIcons: Record<StatPillProps['kind'], string> = {
  streak: '🔥',
  xp: '⚡',
  today: '📅',
};

export function StatPill({ kind, num, label, active = false }: StatPillProps): ReactElement {
  return (
    <div className={`game-stat-pill game-stat-${kind}${active ? ' is-active' : ''}`}>
      <span className="game-stat-icon" aria-hidden="true">{statIcons[kind]}</span>
      <span className="game-stat-copy">
        <strong>{num}</strong>
        <span>{label}</span>
      </span>
    </div>
  );
}

export function GameBar({ streak, xp, level, todayProgress }: GameBarProps): ReactElement {
  const done = Math.max(0, todayProgress.done);
  const total = Math.max(0, todayProgress.total);
  const progressLabel = total > 0 ? `${Math.min(done, total)} / ${total}` : `${done}`;

  return (
    <section className="game-bar glass" aria-label="复习游戏化状态">
      <StatPill kind="streak" num={Math.max(0, streak)} label="连续答对" active={streak > 0} />
      <StatPill kind="xp" num={`${Math.max(0, xp)} XP`} label={level} />
      <StatPill kind="today" num={progressLabel} label="本次复习" />
    </section>
  );
}
