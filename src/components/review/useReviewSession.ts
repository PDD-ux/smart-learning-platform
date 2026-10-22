'use client';

import { useCallback, useState } from 'react';

export type ReviewSessionResponse = {
  xpGain: number;
  newStreak: number;
  newXpTotal: number;
  levelUp?: { from: string; to: string } | null;
};

export type ReviewSessionState = {
  streak: number;
  xp: number;
  level: string;
  todayProgress: { done: number; total: number };
};

export type ReviewSession = ReviewSessionState & {
  applyReviewResponse: (response: ReviewSessionResponse) => void;
};

type UseReviewSessionOptions = {
  streak: number;
  xp: number;
  level: string;
  todayProgress: { done: number; total: number };
};

export function useReviewSession(initial: UseReviewSessionOptions): ReviewSession {
  const [state, setState] = useState<ReviewSessionState>(initial);
  const applyReviewResponse = useCallback((response: ReviewSessionResponse): void => {
    setState((current) => ({
      ...current,
      streak: response.newStreak,
      xp: response.newXpTotal,
      level: response.levelUp?.to ?? current.level,
      todayProgress: {
        done: Math.min(current.todayProgress.done + 1, current.todayProgress.total),
        total: current.todayProgress.total,
      },
    }));
  }, []);

  return { ...state, applyReviewResponse };
}
