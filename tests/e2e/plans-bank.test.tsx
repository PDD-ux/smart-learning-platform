import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ content: vi.fn(), contents: vi.fn(), studyPlans: vi.fn(), createStudyPlan: vi.fn(), completeStudyPlan: vi.fn(), deleteStudyPlan: vi.fn(), exercises: vi.fn(), answerExercise: vi.fn(), understanding: vi.fn(), generateExercise: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m }));
vi.mock('@/components/homework/HomeworkMistakesPanel', () => ({ HomeworkMistakesPanel: (): ReturnType<typeof createElement> => createElement('section', { 'aria-label': '作业错因建议' }) }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReturnType<typeof createElement> => createElement('main', null, children) }));
import Plans from '@/app/study-plans/page';
import Bank from '@/app/question-bank/page';
import { PlanReminders } from '@/components/app/PlanReminders';
const plan = { planId: 'plan1', contentId: 'c1', contentTitle: '梯度课程', title: '今天复习', targetMinutes: 30, scheduledAt: '2026-10-08T10:00:00Z', remindAt: '2026-10-08T09:00:00Z', completedAt: null, isDue: true };
const question = { exerciseId: 'e1', pointId: 'p1', contentId: 'c1', contentTitle: '梯度课程', pointTitle: '梯度', type: 'single_choice', question: '哪个是梯度？', options: ['方向导数', '标量'], index: 0, latestRecord: null };
function responseGate<T>(): { promise: Promise<T>; resolve: (result: T) => void } {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done): void => { resolve = done; });
  return { promise, resolve };
}
beforeEach((): void => {
  vi.resetAllMocks();
  m.contents.mockResolvedValue({ items: [{ contentId: 'c1', title: '梯度课程' }] });
  m.studyPlans.mockResolvedValue({ items: [plan], page: 1, pageSize: 10, total: 1, summary: { totalPlans: 1, completedPlans: 0 } });
  m.createStudyPlan.mockResolvedValue(plan); m.completeStudyPlan.mockResolvedValue(plan);
  m.exercises.mockResolvedValue({ items: [question], page: 1, pageSize: 10, total: 1 });
  m.answerExercise.mockResolvedValue({ correct: true, correctAnswer: 'A', explanation: '梯度是方向导数的组合' });
  m.content.mockResolvedValue({ contentId: 'c1', contentType: 'video', status: '已就绪', durationSec: 120, pageCount: null });
  m.understanding.mockResolvedValue({ contentId: 'c1', transcriptSegments: [{ startMs: 12000, text: '梯度的方向' }], textBlocks: [], knowledgePoints: [{ pointId: 'p1', title: '梯度', summary: '梯度的方向', refs: [{ type: 'video', timestampSec: 12 }] }] }); m.generateExercise.mockResolvedValue({ questions: [] });
});
afterEach((): void => { cleanup(); vi.restoreAllMocks(); });

it('preselects a linked owned material without creating a plan', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [{ contentId: 'c1', title: '第一份' }, { contentId: 'c2', title: '第二份' }] });
  render(<Plans searchParams={{ contentId: 'c2' }} />);
  await screen.findByRole('option', { name: '第二份' });
  expect((screen.getByLabelText('关联资料') as HTMLSelectElement).value).toBe('c2');
  expect(m.createStudyPlan).not.toHaveBeenCalled();
});

it('rejects a linked foreign material instead of silently selecting another material', async (): Promise<void> => {
  render(<Plans searchParams={{ contentId: 'foreign' }} />);
  await screen.findByText('链接指定的资料不在当前可用列表中，请手动选择本人资料。');
  expect((screen.getByLabelText('关联资料') as HTMLSelectElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('关联资料'), { target: { value: 'c1' } });
  expect(screen.queryByText('链接指定的资料不在当前可用列表中，请手动选择本人资料。')).toBeNull();
  expect(m.createStudyPlan).not.toHaveBeenCalled();
});
it('groups only the current page and gives completed status precedence over a stale due flag', async (): Promise<void> => {
  m.studyPlans.mockResolvedValue({ items: [plan, { ...plan, planId: 'future', title: '下次学习', isDue: false }, { ...plan, planId: 'done', title: '已学任务', completedAt: '2026-10-08T10:30:00Z' }], page: 1, pageSize: 10, total: 23, summary: { totalPlans: 23, completedPlans: 12 } });
  render(<Plans />);
  await screen.findByText('我的计划 · 已完成 12 / 23');
  expect(within(screen.getByRole('region', { name: '提醒已到 · 未完成' })).getByText('今天复习')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '待学习' })).getByText('下次学习')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '已完成' })).getByText('已学任务')).toBeTruthy();
  expect(screen.getByText('提醒已到 · 未完成 · 本页 1 项')).toBeTruthy();
  expect(screen.getByText(/不代表学习逾期/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看复习巩固 →' }).getAttribute('href')).toBe('/review');
});
it('keeps a failed create draft and never reports success', async (): Promise<void> => {
  m.createStudyPlan.mockRejectedValue(new Error('写入失败'));
  render(<Plans />); await screen.findByText('今天复习');
  fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '保留草稿' } });
  fireEvent.change(screen.getByLabelText('关联资料'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByLabelText('学习时间'), { target: { value: '2026-10-09T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: '创建计划' }));
  await screen.findByText('写入失败');
  expect((screen.getByLabelText('计划名称') as HTMLInputElement).value).toBe('保留草稿');
  expect(screen.queryByText('计划已创建，提醒将在工作台显示。')).toBeNull();
  expect(m.studyPlans).toHaveBeenCalledTimes(1);
});
it('confirms completion independently of a failed refresh and retries only the list before undo', async (): Promise<void> => {
  const completedPlan = { ...plan, completedAt: '2026-10-08T10:30:00Z', isDue: false };
  m.studyPlans.mockResolvedValueOnce({ items: [plan], page: 1, pageSize: 10, total: 1, summary: { totalPlans: 1, completedPlans: 0 } }).mockRejectedValueOnce(new Error('刷新失败')).mockResolvedValueOnce({ items: [completedPlan], page: 1, pageSize: 10, total: 1, summary: { totalPlans: 1, completedPlans: 1 } });
  render(<Plans />); fireEvent.click(await screen.findByRole('button', { name: '标记完成' }));
  await screen.findByRole('button', { name: '重试计划列表' });
  expect(screen.getByText('已确认计划完成，可随时撤销。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '标记完成' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试计划列表' }));
  const undo = await screen.findByRole('button', { name: '撤销完成' });
  expect(m.completeStudyPlan).toHaveBeenCalledTimes(1);
  fireEvent.click(undo);
  await screen.findByText('已撤销完成，计划恢复为未完成。');
  await screen.findByRole('region', { name: '提醒已到 · 未完成' });
  expect(m.completeStudyPlan).toHaveBeenLastCalledWith('plan1', false);
});
it('explains short-answer grading without leaking the reference and preserves the submitted wording', async (): Promise<void> => {
  m.exercises.mockResolvedValue({ items: [{ ...question, type: 'short_answer', options: [] }], page: 1, pageSize: 10, total: 1 });
  m.answerExercise.mockResolvedValue({ correct: false, correctAnswer: '梯度向量', explanation: '知识点依据' });
  render(<Bank />); fireEvent.click(await screen.findByRole('button', { name: /哪个是梯度/ }));
  const input = screen.getByLabelText('你的答案');
  expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toContain('不做语义判分');
  expect(screen.queryByText('参考答案：梯度向量')).toBeNull();
  fireEvent.change(input, { target: { value: '我的同义表述' } }); fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
  await screen.findByText('未匹配标准答案'); expect(screen.getAllByText('参考答案：梯度向量').length).toBeGreaterThan(0);
  expect(m.answerExercise).toHaveBeenCalledWith('e1', '我的同义表述');
});
it('creates a plan with local times serialized and supports completion', async (): Promise<void> => {
  // 创建后的列表读取可以比写接口慢，旧按钮不能作为刷新完成标志。
  const list = { items: [plan], page: 1, pageSize: 10, total: 1, summary: { totalPlans: 1, completedPlans: 0 } };
  const createdPlan = { ...plan, title: '预习' };
  const created = responseGate<typeof plan>();
  const refreshed = responseGate<typeof list>();
  const completedPlan = { ...createdPlan, completedAt: '2026-10-09T10:30:00Z' };
  const completed = responseGate<typeof completedPlan>();
  m.createStudyPlan.mockReturnValueOnce(created.promise);
  m.studyPlans.mockResolvedValueOnce(list).mockReturnValueOnce(refreshed.promise);
  m.completeStudyPlan.mockReturnValueOnce(completed.promise);
  render(<Plans />);
  await screen.findByText('今天复习');
  expect(screen.getByRole('link', { name: '进入每日打卡与人脸登录设置 →' }).getAttribute('href')).toBe('/attendance');
  expect(m.completeStudyPlan).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '预习' } });
  fireEvent.change(screen.getByLabelText('关联资料'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByLabelText('学习时间'), { target: { value: '2026-10-09T10:00' } });
  fireEvent.change(screen.getByLabelText('提醒时间'), { target: { value: '2026-10-09T09:00' } });
  fireEvent.click(screen.getByText('创建计划'));
  expect(m.createStudyPlan).toHaveBeenCalledTimes(1);
  expect(m.createStudyPlan).toHaveBeenCalledWith({ title: '预习', contentId: 'c1', targetMinutes: 30, scheduledAt: new Date('2026-10-09T10:00').toISOString(), remindAt: new Date('2026-10-09T09:00').toISOString() });
  expect((screen.getByRole('button', { name: '标记完成' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async (): Promise<void> => { created.resolve(createdPlan); });
  await screen.findByText('正在加载计划…');
  expect(screen.queryByRole('button', { name: '标记完成' })).toBeNull(); expect(m.completeStudyPlan).not.toHaveBeenCalled();
  expect(m.studyPlans).toHaveBeenCalledTimes(2);
  await act(async (): Promise<void> => { refreshed.resolve({ ...list, items: [createdPlan] }); });
  await screen.findByText('预习'); expect(screen.queryByText('今天复习')).toBeNull();
  const completeButton = await screen.findByRole('button', { name: '标记完成' });
  expect((completeButton as HTMLButtonElement).disabled).toBe(false);
  m.studyPlans.mockResolvedValueOnce({ ...list, items: [completedPlan], summary: { totalPlans: 1, completedPlans: 1 } });
  fireEvent.click(completeButton);
  expect(m.completeStudyPlan).toHaveBeenCalledWith('plan1', true); expect(m.completeStudyPlan).toHaveBeenCalledTimes(1);
  expect((completeButton as HTMLButtonElement).disabled).toBe(true);
  await act(async (): Promise<void> => { completed.resolve(completedPlan); });
  await screen.findByRole('button', { name: '撤销完成' });
  expect(screen.getByText('我的计划 · 已完成 1 / 1')).toBeTruthy(); expect(m.studyPlans).toHaveBeenCalledTimes(3);
});
it('shows plan errors and empty states', async () => {
  m.studyPlans.mockResolvedValue({ items: [], total: 0, summary: { totalPlans: 0, completedPlans: 0 } });
  m.contents.mockRejectedValue(new Error('资料读取失败'));
  render(<Plans />);
  expect((await screen.findByRole('alert')).textContent).toContain('资料读取失败');
  await screen.findByText('暂无计划，先安排一次学习吧。');
});
it('shows due reminders linking directly to the related lesson', async () => {
  render(<PlanReminders />);
  expect((await screen.findByText(/今天复习/)).getAttribute('href')).toBe('/study/c1');
});
it('uses the server reminder total rather than the displayed first-page length', async (): Promise<void> => {
  m.studyPlans.mockResolvedValue({ items: [plan], page: 1, pageSize: 10, total: 15, summary: { totalPlans: 20, completedPlans: 5 } });
  render(<PlanReminders />);
  await screen.findByText('计划进度：已完成 5 / 20');
  expect(screen.getByText(/共 15 条，当前展示 1 条/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /今天复习 · 目标 30 分钟/ }).getAttribute('href')).toBe('/study/c1');
});

it('keeps plan loading and failures distinct from zero plans and retries without losing form input', async (): Promise<void> => {
  m.contents.mockRejectedValueOnce(new Error('失败')); m.studyPlans.mockRejectedValueOnce(new Error('失败')); render(<Plans />);
  await screen.findByRole('button', { name: '重试计划资料' }); expect(screen.queryByText(/已完成 0 \/ 0/)).toBeNull(); expect(screen.queryByText('暂无计划，先安排一次学习吧。')).toBeNull();
  fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '保留计划草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '重试计划列表' })); await screen.findByText('今天复习'); expect(m.contents).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试计划资料' })); await screen.findByRole('option', { name: '梯度课程' });
  expect((screen.getByLabelText('计划名称') as HTMLInputElement).value).toBe('保留计划草稿'); expect(m.studyPlans).toHaveBeenCalledTimes(2); expect(m.createStudyPlan).not.toHaveBeenCalled();
});

it('does not show reminder zeros while loading or failed and has a separate retry', async (): Promise<void> => {
  m.studyPlans.mockReturnValueOnce(new Promise<never>(() => undefined)); render(<PlanReminders />);
  expect(screen.getByText('正在读取学习提醒…')).toBeTruthy(); expect(screen.queryByText(/已完成 0 \/ 0/)).toBeNull(); expect(screen.queryByText(/暂时没有到期计划/)).toBeNull();
  cleanup(); m.studyPlans.mockRejectedValueOnce(new Error('失败')); render(<PlanReminders />); await screen.findByRole('button', { name: '重试学习提醒' });
  m.studyPlans.mockResolvedValueOnce({ items: [], summary: { totalPlans: 0, completedPlans: 0 } }); fireEvent.click(screen.getByRole('button', { name: '重试学习提醒' }));
  await screen.findByText('计划进度：已完成 0 / 0'); expect(screen.getByText(/暂时没有到期计划/)).toBeTruthy();
});
it('hides unattempted answers, submits an option and resets on filter change', async () => {
  render(<Bank />);
  fireEvent.click(await screen.findByRole('button', { name: /哪个是梯度/ }));
  expect(screen.queryByText(/正确答案/)).toBeNull();
  expect(m.understanding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: /方向导数/ }));
  fireEvent.click(screen.getByText('提交答案'));
  await screen.findByText('回答正确');
  expect(m.answerExercise).toHaveBeenCalledWith('e1', 'A');
  expect((await screen.findByRole('link', { name: '回看视频 0:12' })).getAttribute('href')).toBe('/study/c1?t=12');
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'wrong' } });
  await waitFor(() => expect(m.exercises).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'wrong', page: 1 })));
  expect(screen.queryByText('回答正确')).toBeNull();
  expect(screen.queryByRole('region', { name: '知识点来源' })).toBeNull();
});

it('connects a historical wrong question to its knowledge point and source without resubmitting', async () => {
  m.exercises.mockResolvedValue({ items: [{ ...question, latestRecord: { correct: false, userAnswer: 'B', correctAnswer: 'A', explanation: '依据', createdAt: '2026-10-10' } }], page: 1, pageSize: 10, total: 1 });
  render(<Bank />);
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'wrong' } });
  fireEvent.click(await screen.findByRole('button', { name: /哪个是梯度/ }));
  await screen.findByText('知识点补强');
  expect((await screen.findByRole('link', { name: '回看视频 0:12' })).getAttribute('href')).toBe('/study/c1?t=12');
  expect(m.answerExercise).not.toHaveBeenCalled();
});
it('generates from the selected content knowledge points', async () => {
  render(<Bank />); await screen.findByRole('button', { name: /哪个是梯度/ });
  fireEvent.change(screen.getByLabelText('资料'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByLabelText('出题数量'), { target: { value: '5' } });
  fireEvent.click(screen.getByText('为选定资料生成 5 题'));
  await waitFor(() => expect(m.generateExercise).toHaveBeenCalledWith({ pointIds: ['p1'], count: 5 }));
});

it('opens historical wrong filtering directly from the dashboard link', async () => {
  render(<Bank searchParams={{ status: 'wrong' }} />);
  await screen.findByRole('button', { name: /哪个是梯度/ });
  expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('wrong');
  expect(m.exercises).toHaveBeenCalledWith(expect.objectContaining({ status: 'wrong', page: 1 }));
});

it('returns to a valid page after deleting the last plan on page two', async () => {
  let deleted = false;
  m.studyPlans.mockImplementation(async (page: number) => ({ items: page === 2 && deleted ? [] : [plan], total: deleted ? 10 : 11, page, pageSize: 10, summary: { totalPlans: deleted ? 10 : 11, completedPlans: 0 } }));
  m.deleteStudyPlan.mockImplementation(async () => { deleted = true; return { deleted: true }; });
  // Happy DOM does not implement native confirmation dialogs; simulate acceptance explicitly.
  vi.stubGlobal('confirm', vi.fn(() => true));
  try {
    render(<Plans />); await screen.findByText('今天复习');
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => expect(m.studyPlans).toHaveBeenLastCalledWith(2));
    await screen.findByText('今天复习'); fireEvent.click(screen.getByText('删除'));
    await waitFor(() => expect(m.studyPlans).toHaveBeenLastCalledWith(1));
    expect(screen.getByText('第 1 页')).toBeTruthy();
  } finally { vi.unstubAllGlobals(); }
});

