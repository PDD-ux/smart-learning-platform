'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

export type AchievementToastData = {
  key: string;
  icon: string;
  title: string;
  desc: string;
};

export type AchievementToastProps = {
  achievement: AchievementToastData | null;
  onHide: () => void;
};

export function AchievementToast({ achievement, onHide }: AchievementToastProps): ReactElement | null {
  const seenKeys = useRef<Set<string>>(new Set());
  const [visibleAchievement, setVisibleAchievement] = useState<AchievementToastData | null>(null);
  const achievementKey = achievement?.key ?? null;
  const achievementRef = useRef(achievement);
  achievementRef.current = achievement;

  useEffect(() => {
    const currentAchievement = achievementRef.current;
    if (!currentAchievement || seenKeys.current.has(currentAchievement.key)) return;
    seenKeys.current.add(currentAchievement.key);
    setVisibleAchievement(currentAchievement);
    const timer = window.setTimeout(() => {
      setVisibleAchievement(null);
      onHide();
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [achievementKey, onHide]);

  if (!visibleAchievement) return null;

  const hide = (): void => {
    setVisibleAchievement(null);
    onHide();
  };

  return (
    <aside className="achievement-toast" role="status" aria-live="polite">
      <span className="achievement-toast-icon" aria-hidden="true">{visibleAchievement.icon}</span>
      <span className="achievement-toast-copy">
        <strong>{visibleAchievement.title}</strong>
        <span>{visibleAchievement.desc}</span>
      </span>
      <button type="button" className="achievement-toast-close" onClick={hide} aria-label="关闭成就提示">
        ×
      </button>
    </aside>
  );
}
