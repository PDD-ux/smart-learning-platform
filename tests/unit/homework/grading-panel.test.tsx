import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HomeworkView } from '@/lib/homework/contracts';
import type { HomeworkGradingReport, ReportCommand } from '@/lib/homework/grading-contracts';
import { HomeworkGradingPanel } from '@/components/homework/HomeworkGradingPanel';

const api = vi.hoisted(() => ({ grading: vi.fn(), createGrading: vi.fn(), runGrading: vi.fn(), commandGrading: vi.fn() }));
vi.mock('@/services/homework', () => ({ homework: api }));

const draft: HomeworkView = {
  id: 'synthetic-draft', title: '合成作业', state: 'CONFIRMED', revision: 3,
  source: { kind: 'text', label: '合成校对材料' }, rawText: '只供组件测试', issues: [], createdAt: new Date(0).toISOString(),
  questions: [{ number: '1', type: 'short', prompt: '2+2等于多少？', answer: '3', referenceAnswer: '4', basis: '参考答案为4。', reviewed: true }],
};
const baseReport: HomeworkGradingReport = {
  id: 'synthetic-report', requestId: '2a8dbbc3-e9ef-40ac-9b6a-67a6959ec7ce', state: 'READY', revision: 3, sourceRevision: 3,
  questionNumbers: ['1'], result: { items: [{ number: '1', assessment: 'incorrect', suggestedScore: 0, errorCause: 'calculation', reason: '答案与参考依据不一致。', evidenceQuote: '参考答案为4。', nextStep: '重新核算加法。', objectiveMatch: 'unavailable', objectiveScore: null }] },
  corrections: [], errorCode: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};

beforeEach((): void => {
  vi.resetAllMocks();
  api.grading.mockResolvedValue({ items: [] });
  api.createGrading.mockResolvedValue({ ...baseReport, state: 'PENDING', result: null, revision: 1 });
  api.runGrading.mockResolvedValue(baseReport);
});
afterEach(cleanup);

it('requires consent, renders separate AI evidence, and keeps before/after correction history', async (): Promise<void> => {
  render(<HomeworkGradingPanel draft={draft} />);
  await screen.findByText('还没有AI批改报告。完成校对确认后，可按批次分析。');
  fireEvent.click(screen.getByRole('checkbox', { name: /我同意将选中题目/ }));
  fireEvent.click(screen.getByRole('button', { name: '分析所选 1 题' }));

  await screen.findByText('AI建议：不符合 · 0/100');
  expect(api.createGrading).toHaveBeenCalledWith('synthetic-draft', expect.objectContaining({ consent: true, questionNumbers: ['1'], expectedDraftRevision: 3 }));
  expect(screen.getByText(/依据摘录（本人提供，未经外部核实）/)).toBeTruthy();
  expect(screen.getByText(/不是教师评分/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText('订正后的答案'), { target: { value: '4' } });
  const correction: ReportCommand = { action: 'correct', requestId: 'bbce0103-dbc1-4f4f-a34b-734537e83ea0', expectedRevision: 3, consent: true, number: '1', answer: '4' };
  api.commandGrading.mockResolvedValue({
    ...baseReport,
    revision: 5,
    corrections: [{ requestId: correction.requestId, number: '1', beforeAnswer: '3', correctedAnswer: '4', state: 'READY', result: { ...baseReport.result?.items[0], assessment: 'correct', suggestedScore: 100, errorCause: 'none', reason: '订正后答案与依据一致。' }, errorCode: null, createdAt: new Date(1).toISOString(), completedAt: new Date(2).toISOString() }],
  });
  fireEvent.click(screen.getByRole('button', { name: '保存订正并重新核对' }));
  await screen.findByText('订正前：3');
  expect(api.commandGrading).toHaveBeenCalledWith('synthetic-draft', 'synthetic-report', expect.objectContaining({ action: 'correct', consent: true, number: '1', answer: '4' }));
  await waitFor((): void => expect(screen.getByText('订正后：4')).toBeTruthy());
});
