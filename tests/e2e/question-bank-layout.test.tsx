import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BankList, BankQuestion } from '@/services/api';

const m = vi.hoisted(() => ({ contents: vi.fn(), exercises: vi.fn(), answerExercise: vi.fn(), generateExercise: vi.fn(), understanding: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m }));
vi.mock('@/components/homework/HomeworkMistakesPanel', () => ({ HomeworkMistakesPanel: (): ReactElement => createElement('section', { 'aria-label': '作业错因建议' }) }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactElement => createElement('main', null, children) }));
vi.mock('@/components/review/ExerciseSourcePanel', () => ({ ExerciseSourcePanel: (): ReactElement => createElement('section', { 'aria-label': '知识点来源' }, '来源回看') }));
import QuestionBankPage from '@/app/question-bank/page';

const question: BankQuestion = { exerciseId: 'q1', pointId: 'p1', contentId: 'c1', contentTitle: '30分钟课程', pointTitle: '向量', type: 'single_choice', question: '请阅读下面的课堂情境，再选择正确的表述。\n这里是需要完整保留的较长题干。', options: ['第一项', '第二项'], index: 0, latestRecord: null };
function list(items: BankQuestion[] = [question], total = items.length, pageSize = 10): BankList { return { items, total, page: 1, pageSize }; }
beforeEach((): void => { vi.resetAllMocks(); m.contents.mockResolvedValue({ items: [] }); m.exercises.mockResolvedValue(list()); m.answerExercise.mockResolvedValue({ correct: true, correctAnswer: 'A', explanation: '解析' }); });
afterEach((): void => { cleanup(); });

it('starts with one question and preserves the chosen count and existing list when generation fails', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [{ contentId: 'c1', title: '短课程' }] });
  m.understanding.mockResolvedValue({ knowledgePoints: [{ pointId: 'p1' }] });
  let reject!: (error: Error) => void;
  m.generateExercise.mockImplementation(() => new Promise((_resolve, failure): void => { reject = failure; }));
  render(<QuestionBankPage searchParams={{ contentId: 'c1' }} />);
  await screen.findByRole('heading', { name: '题目列表 · 1 题' });
  expect((screen.getByLabelText('出题数量') as HTMLSelectElement).value).toBe('1');
  expect(screen.getByRole('button', { name: '为选定资料生成 1 题' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('出题数量'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '为选定资料生成 3 题' }));
  await waitFor(() => expect(m.generateExercise).toHaveBeenCalledWith({ pointIds: ['p1'], count: 3 }));
  expect((screen.getByLabelText('出题数量') as HTMLSelectElement).disabled).toBe(true);
  await act(async (): Promise<void> => { reject(new Error('资料不足，本批未保存')); });
  await screen.findByRole('alert');
  expect((screen.getByLabelText('出题数量') as HTMLSelectElement).value).toBe('3');
  expect(screen.getByRole('button', { name: /请阅读下面/ })).toBeTruthy();
  expect(m.generateExercise).toHaveBeenCalledTimes(1);
});

it('preserves the exact point deep link and can remove that filter', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [{ contentId: 'c1', title: '课程一' }, { contentId: 'c2', title: '课程二' }] });
  render(<QuestionBankPage searchParams={{ contentId: 'c1', pointId: 'p1' }} />);
  await screen.findByRole('heading', { name: '题目列表 · 1 题' });
  expect(m.exercises).toHaveBeenLastCalledWith({ contentId: 'c1', pointId: 'p1', type: '', status: 'all', page: 1 });
  fireEvent.click(screen.getByRole('button', { name: '取消知识点筛选' }));
  await waitFor((): void => expect(m.exercises).toHaveBeenLastCalledWith({ contentId: 'c1', type: '', status: 'all', page: 1 }));
  expect(screen.queryByText('当前仅显示所选知识点的题目。')).toBeNull();
});

it('clears the old point when switching materials', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [{ contentId: 'c1', title: '课程一' }, { contentId: 'c2', title: '课程二' }] });
  render(<QuestionBankPage searchParams={{ contentId: 'c1', pointId: 'p1' }} />);
  await screen.findByRole('heading', { name: '题目列表 · 1 题' });
  fireEvent.change(screen.getByLabelText('资料'), { target: { value: 'c2' } });
  await waitFor((): void => expect(m.exercises).toHaveBeenLastCalledWith({ contentId: 'c2', type: '', status: 'all', page: 1 }));
});

it('shows unknown totals and disables actions while the list is loading', async (): Promise<void> => {
  let resolve!: (value: BankList) => void;
  m.exercises.mockImplementationOnce(() => new Promise<BankList>((success): void => { resolve = success; }));
  render(<QuestionBankPage />);
  expect(screen.getByRole('heading', { name: '题目列表' })).toBeTruthy();
  expect(screen.queryByText(/题目列表 · 0/)).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('正在加载题目…');
  expect((screen.getByRole('button', { name: '开始本页练习' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async (): Promise<void> => { resolve(list()); });
  await screen.findByRole('heading', { name: '题目列表 · 1 题' });
});

it('shows a real empty result without a selected question or enabled practice group', async (): Promise<void> => {
  m.exercises.mockResolvedValue(list([])); render(<QuestionBankPage />);
  await screen.findByRole('heading', { name: '题目列表 · 0 题' });
  expect(screen.getByText('当前筛选下暂无可练习的题目。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '开始本页练习 · 0 题' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '提交答案' })).toBeNull();
});

it('retries a failed list with its existing filters rather than claiming zero questions', async (): Promise<void> => {
  m.exercises.mockRejectedValueOnce(new Error('列表暂时不可用'));
  render(<QuestionBankPage searchParams={{ status: 'wrong' }} />);
  await screen.findByText('列表暂时不可用');
  expect(screen.queryByText(/题目列表 · 0/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载题库' }));
  await screen.findByRole('heading', { name: '题目列表 · 1 题' });
  expect(m.exercises).toHaveBeenLastCalledWith({ contentId: '', type: '', status: 'wrong', page: 1 });
});

it('puts the full multiline question in the answer region without showing answers before submission', async (): Promise<void> => {
  render(<QuestionBankPage />);
  const choice = await screen.findByRole('button', { name: /请阅读下面/ }); fireEvent.click(choice);
  expect(choice.getAttribute('aria-pressed')).toBe('true');
  const panel = screen.getByRole('region', { name: '作答区' });
  expect(within(panel).getByRole('heading', { level: 3 }).textContent).toBe(question.question);
  expect(within(panel).getByText('单选题')).toBeTruthy();
  expect(within(panel).queryByText(/正确答案/)).toBeNull();
  expect(within(panel).queryByRole('region', { name: '知识点来源' })).toBeNull();
  fireEvent.click(within(panel).getByRole('radio', { name: /第一项/ }));
  fireEvent.click(within(panel).getByRole('button', { name: '提交答案' }));
  await within(panel).findByText('回答正确');
  expect(m.answerExercise).toHaveBeenCalledWith('q1', 'A');
  expect(within(within(panel).getByRole('status')).getByText('正确答案：A. 第一项')).toBeTruthy();
  expect(within(panel).getByRole('region', { name: '知识点来源' })).toBeTruthy();
});
it('shows historical boolean answers in Chinese without submitting a new answer', async (): Promise<void> => {
  m.exercises.mockResolvedValue(list([{ ...question, type: 'true_false', options: [], latestRecord: { userAnswer: 'true', correct: false, correctAnswer: 'false', explanation: '历史解析', createdAt: '2026-10-13' } }]));
  render(<QuestionBankPage />); fireEvent.click(await screen.findByRole('button', { name: /请阅读下面/ }));
  fireEvent.click(screen.getByText('查看上次作答与解析'));
  expect(screen.getByText('你的答案：正确')).toBeTruthy(); expect(screen.getByText('正确答案：错误')).toBeTruthy();
  expect(m.answerExercise).not.toHaveBeenCalled();
});

it('removes selected details on filtering and ignores a late response from the old filter', async (): Promise<void> => {
  let resolve!: (value: BankList) => void;
  render(<QuestionBankPage />); fireEvent.click(await screen.findByRole('button', { name: /请阅读下面/ }));
  m.exercises.mockImplementationOnce(() => new Promise<BankList>((success): void => { resolve = success; }));
  fireEvent.change(screen.getByLabelText('题型'), { target: { value: 'true_false' } });
  expect(within(screen.getByRole('region', { name: '作答区' })).queryByRole('heading', { level: 3 })).toBeNull();
  m.exercises.mockResolvedValueOnce(list([]));
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'wrong' } });
  await screen.findByRole('heading', { name: '题目列表 · 0 题' });
  await act(async (): Promise<void> => { resolve(list()); });
  expect(screen.queryByRole('button', { name: /请阅读下面/ })).toBeNull();
});

it('uses the returned page size for pagination and numbers while preserving history status', async (): Promise<void> => {
  m.exercises.mockResolvedValueOnce(list([question], 3, 2)).mockResolvedValueOnce(list([{ ...question, latestRecord: { userAnswer: 'B', correct: false, correctAnswer: 'A', explanation: '历史解析', createdAt: '2026-10-10' } }], 3, 2));
  render(<QuestionBankPage />); await screen.findByRole('heading', { name: '题目列表 · 3 题' });
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('第 3 题 · 单选题');
  await waitFor(() => expect(m.exercises).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  expect(screen.getByText('上次答错')).toBeTruthy();
  expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /请阅读下面/ }));
  expect(screen.getByText('查看上次作答与解析')).toBeTruthy();
  expect(m.answerExercise).not.toHaveBeenCalled();
});
