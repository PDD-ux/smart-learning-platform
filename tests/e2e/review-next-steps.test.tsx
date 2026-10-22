import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Flashcard } from '@/services/api';
import { ReviewNextSteps } from '@/components/review/ReviewNextSteps';

const card: Flashcard = { flashcardId: 'f', contentId: '课程/a', pointId: '知识 点', cardType: 'QA', front: '回忆问题', back: '参考', hint: null, status: 'NEW', nextReviewAt: '', easeFactor: 2.5, intervalDays: 0, pointTitle: '本次知识点', contentTitle: '课程' };
afterEach((): void => cleanup());
it('uses the exact successful card scope and distinguishes self-report from a test', (): void => {
  render(<ReviewNextSteps records={[{ card, rating: 0, nextReviewAt: '2026-10-14T00:00:00Z' }]} />);
  expect(screen.getByRole('link', { name: '回看这份资料' }).getAttribute('href')).toBe('/study/%E8%AF%BE%E7%A8%8B%2Fa');
  expect(screen.getByRole('link', { name: '查看对应知识点练习' }).getAttribute('href')).toBe('/question-bank?contentId=%E8%AF%BE%E7%A8%8B%2Fa&pointId=%E7%9F%A5%E8%AF%86%20%E7%82%B9');
  expect(screen.getByText(/不代表客观测验通过/)).toBeTruthy();
});
it('does not invent a point or schedule when the successful record lacks valid metadata', (): void => {
  render(<ReviewNextSteps records={[{ card: { ...card, pointId: null }, rating: 1, nextReviewAt: 'invalid' }]} />);
  expect(screen.getByRole('link', { name: '浏览这份资料的题库' }).getAttribute('href')).not.toContain('pointId');
  expect(screen.getByText(/排期暂不可用/)).toBeTruthy(); expect(screen.queryByRole('link', { name: '查看对应知识点练习' })).toBeNull();
});
it('does not call remembered items weak or infer a perfect mastery score', (): void => {
  render(<ReviewNextSteps records={[{ card, rating: 3, nextReviewAt: '2026-10-14T00:00:00Z' }]} />);
  expect(screen.getByText(/本次没有自评/)).toBeTruthy(); expect(screen.queryByRole('link', { name: '回看这份资料' })).toBeNull();
  expect(screen.getByText('本次记录与下次安排 · 1 项')).toBeTruthy();
});
