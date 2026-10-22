import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BankQuestion } from '@/services/api';
const m = vi.hoisted(() => ({ contents: vi.fn(), exercises: vi.fn(), answerExercise: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m }));
vi.mock('@/components/homework/HomeworkMistakesPanel', () => ({ HomeworkMistakesPanel: (): ReturnType<typeof createElement> => createElement('section', { 'aria-label': '作业错因建议' }) }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReturnType<typeof createElement> => createElement('main', null, children) }));
vi.mock('@/components/review/ExerciseSourcePanel', () => ({ ExerciseSourcePanel: (): ReturnType<typeof createElement> => createElement('p', null, '来源回看面板') }));
import Bank from '@/app/question-bank/page';
const first: BankQuestion = { exerciseId: 'q1', pointId: 'p1', contentId: 'c1', contentTitle: '课程', pointTitle: '梯度', type: 'single_choice', question: '第一题', options: ['选项甲', '选项乙'], index: 0, latestRecord: { userAnswer: 'B', correct: false, correctAnswer: 'A', explanation: '历史解析', createdAt: '' } };
const second: BankQuestion = { ...first, exerciseId: 'q2', type: 'true_false', question: '第二题', options: [], latestRecord: null };
function list(items: BankQuestion[] = [first, second], total = items.length): { items: BankQuestion[]; total: number; page: number; pageSize: number } { return { items, total, page: 1, pageSize: 10 }; }
beforeEach(() => { vi.resetAllMocks(); m.contents.mockResolvedValue({ items: [] }); m.exercises.mockResolvedValue(list()); m.answerExercise.mockResolvedValue({ correct: true, correctAnswer: 'A', explanation: '本次解析' }); });
afterEach(() => cleanup());
async function start(): Promise<void> { render(<Bank />); fireEvent.click(await screen.findByRole('button', { name: '开始本页练习 · 2 题' })); }
async function submitFirst(): Promise<void> { fireEvent.click(screen.getByRole('radio', { name: /选项甲/ })); fireEvent.click(screen.getByRole('button', { name: '提交本题答案' })); await screen.findByText('回答正确'); }

it('freezes the filtered group, excludes historical scores and summarizes actual results', async () => {
  render(<Bank />); await screen.findByText('题目列表 · 2 题');
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'unanswered' } });
  fireEvent.click(await screen.findByRole('button', { name: '开始本页练习 · 2 题' }));
  expect(screen.getByText('本组已答 0 / 2 题')).toBeTruthy(); expect(screen.queryByText('历史解析')).toBeNull(); expect(screen.queryByText('来源回看面板')).toBeNull();
  const reads = m.exercises.mock.calls.length;
  await submitFirst(); fireEvent.click(screen.getByText('下一题'));
  m.answerExercise.mockResolvedValue({ correct: false, correctAnswer: 'false', explanation: '错题解析' });
  fireEvent.click(screen.getByRole('button', { name: /^正确$/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('还需巩固'); expect(m.answerExercise).toHaveBeenLastCalledWith('q2', 'true'); expect(m.exercises).toHaveBeenCalledTimes(reads);
  expect(screen.getByText('正确答案：错误')).toBeTruthy();
  fireEvent.click(screen.getByText('查看本组总结')); await screen.findByText('本组正确率 50%');
  expect(screen.getByText('梯度 · 1 道错题')).toBeTruthy(); fireEvent.click(screen.getByText('核对错题：梯度')); await screen.findByText('错题解析');
  fireEvent.click(screen.getByText('返回题库')); await screen.findByText('题目列表 · 2 题'); expect(m.exercises).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unanswered' }));
});
it('replaces the result on redo without counting another question', async () => {
  m.exercises.mockResolvedValue(list([first])); render(<Bank />); fireEvent.click(await screen.findByText('开始本页练习 · 1 题'));
  m.answerExercise.mockResolvedValueOnce({ correct: false, correctAnswer: 'B', explanation: '错误解析' });
  fireEvent.click(screen.getByRole('radio', { name: /选项甲/ })); fireEvent.click(screen.getByText('提交本题答案')); await screen.findByText('还需巩固');
  fireEvent.click(screen.getByText('重做本题')); expect((screen.getByText('查看本组总结') as HTMLButtonElement).disabled).toBe(true);
  await submitFirst(); expect(screen.getByText('本组已答 1 / 1 题')).toBeTruthy();
  fireEvent.click(screen.getByText('查看本组总结')); await screen.findByText('本组正确率 100%'); expect(screen.getByText('本组共 1 题，答对 1 题，答错 0 题。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /只重练本轮错题/ })).toBeNull();
});
it('starts a fresh wrong-only round without historical scores or corrected-answer leakage', async (): Promise<void> => {
  await start(); await submitFirst(); fireEvent.click(screen.getByText('下一题'));
  m.answerExercise.mockResolvedValueOnce({ correct: false, correctAnswer: 'false', explanation: '第一轮错题解析' });
  fireEvent.click(screen.getByRole('button', { name: /^正确$/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('还需巩固'); fireEvent.click(screen.getByText('查看本组总结'));
  fireEvent.click(screen.getByRole('button', { name: '只重练本轮错题 · 1 题' }));
  expect(screen.getByText('第 2 轮 · 仅重练上一轮错题')).toBeTruthy();
  expect(screen.getByText('上一轮共 2 题，答对 1 题，答错 1 题。')).toBeTruthy();
  expect(screen.getByText('本组已答 0 / 1 题')).toBeTruthy(); expect(screen.queryByText('第一题')).toBeNull();
  expect(screen.queryByText('第一轮错题解析')).toBeNull(); expect(screen.queryByText('来源回看面板')).toBeNull();
  expect(m.answerExercise).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: /^错误$/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('回答正确'); expect(m.answerExercise).toHaveBeenLastCalledWith('q2', 'false');
  fireEvent.click(screen.getByText('查看本组总结')); await screen.findByText('本组共 1 题，答对 1 题，答错 0 题。');
  expect(screen.getByText('上一轮共 2 题，答对 1 题，答错 1 题。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /只重练本轮错题/ })).toBeNull();
});
it('keeps retry failures and limits the next round to that round’s remaining wrong items', async (): Promise<void> => {
  m.answerExercise.mockResolvedValue({ correct: false, correctAnswer: 'false', explanation: '错题解析' });
  await start(); fireEvent.click(screen.getByRole('radio', { name: /选项甲/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('还需巩固'); fireEvent.click(screen.getByText('下一题'));
  fireEvent.click(screen.getByRole('button', { name: /^正确$/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('还需巩固'); fireEvent.click(screen.getByText('查看本组总结'));
  fireEvent.click(screen.getByRole('button', { name: '只重练本轮错题 · 2 题' }));
  m.answerExercise.mockRejectedValueOnce(new Error('重练判分失败'));
  fireEvent.click(screen.getByRole('radio', { name: /选项甲/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByRole('alert'); expect(screen.getByText('本组已答 0 / 2 题')).toBeTruthy();
  expect((screen.getByRole('radio', { name: /选项甲/ }) as HTMLInputElement).checked).toBe(true);
  m.answerExercise.mockResolvedValueOnce({ correct: true, correctAnswer: 'A', explanation: '订正正确' });
  fireEvent.click(screen.getByText('提交本题答案')); await screen.findByText('回答正确'); fireEvent.click(screen.getByText('下一题'));
  fireEvent.click(screen.getByRole('button', { name: /^正确$/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('还需巩固'); fireEvent.click(screen.getByText('查看本组总结'));
  fireEvent.click(screen.getByRole('button', { name: '只重练本轮错题 · 1 题' }));
  expect(screen.getByText('第 3 轮 · 仅重练上一轮错题')).toBeTruthy(); expect(screen.queryByText('第一题')).toBeNull();
  expect(screen.getByText('本组已答 0 / 1 题')).toBeTruthy(); expect(screen.queryByText('错题解析')).toBeNull();
});
it('retains draft answers while skipping and only enables summary after every answer', async () => {
  await start(); fireEvent.click(screen.getByRole('radio', { name: /选项甲/ })); fireEvent.click(screen.getByText('下一题')); fireEvent.click(screen.getByText('上一题'));
  expect((screen.getByRole('radio', { name: /选项甲/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByText('查看本组总结') as HTMLButtonElement).disabled).toBe(true); expect(m.answerExercise).not.toHaveBeenCalled();
});
it('preserves failed answers and prevents repeated submissions or navigation during grading', async () => {
  let reject!: (reason: Error) => void;
  m.answerExercise.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  await start(); fireEvent.click(screen.getByRole('radio', { name: /选项甲/ })); const submit = screen.getByText('提交本题答案'); fireEvent.click(submit); fireEvent.click(submit);
  expect(m.answerExercise).toHaveBeenCalledTimes(1); expect((screen.getByText('下一题') as HTMLButtonElement).disabled).toBe(true); expect((screen.getByText('返回题库') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('网络失败'))); await screen.findByRole('alert');
  expect(screen.getByText('本组已答 0 / 2 题')).toBeTruthy(); expect((screen.getByRole('radio', { name: /选项甲/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByText('提交本题答案')); await screen.findByText('回答正确');
});
it('supports short-answer drafts without a model call and reports zero percent accurately', async () => {
  m.exercises.mockResolvedValue(list([{ ...first, type: 'short_answer', options: [] }])); m.answerExercise.mockResolvedValue({ correct: false, correctAnswer: '标准答案', explanation: '解析' });
  render(<Bank />); fireEvent.click(await screen.findByText('开始本页练习 · 1 题'));
  const input = screen.getByLabelText('你的答案');
  expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toContain('不做语义判分');
  expect(screen.queryByText('参考答案：标准答案')).toBeNull();
  fireEvent.change(input, { target: { value: '自己的理解' } }); fireEvent.click(screen.getByText('提交本题答案')); await screen.findByText('未匹配标准答案');
  expect(screen.getByText('参考答案：标准答案')).toBeTruthy();
  expect(m.answerExercise).toHaveBeenCalledWith('q1', '自己的理解'); fireEvent.click(screen.getByText('查看本组总结')); await screen.findByText('本组正确率 0%');
  expect(screen.getByText('本组正确率包含简答的文字匹配结果，不代表语义掌握率。')).toBeTruthy();
});
it('returns to a valid page when completed unanswered questions empty the last page', async () => {
  let submitted = false;
  m.exercises.mockImplementation(async ({ page }: { page: number }) => list(page === 2 ? submitted ? [] : [first] : [second], submitted ? 10 : 11));
  m.answerExercise.mockImplementation(async () => { submitted = true; return { correct: true, correctAnswer: 'A', explanation: '本次解析' }; });
  render(<Bank />); await screen.findByText('题目列表 · 11 题'); fireEvent.click(screen.getByText('下一页')); await screen.findByRole('button', { name: /第一题/ });
  fireEvent.click(screen.getByText('开始本页练习 · 1 题')); await submitFirst(); fireEvent.click(screen.getByText('返回题库'));
  await waitFor(() => expect(m.exercises).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))); await screen.findByText('第 1 页');
});
