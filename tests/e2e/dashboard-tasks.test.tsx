import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContentSummary, Progress } from '@/services/api';

const mocks = vi.hoisted(() => ({ progress: vi.fn(), exercises: vi.fn(), today: vi.fn(), checkIn: vi.fn() }));
vi.mock('@/services/api', () => ({ api: mocks }));
vi.mock('@/services/attendance', () => ({ attendanceApi: mocks }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }): ReturnType<typeof createElement> => createElement('a', { ...props, href }, children) }));
import { TodayLearningTasks } from '@/components/app/TodayLearningTasks';
import { DailyCheckInCard } from '@/components/app/DailyCheckInCard';

const video: ContentSummary = { contentId: 'video', contentType: 'video', title: '最新上传的视频', durationSec: 1800, pageCount: null, status: '已就绪', understandingStatus: 'completed', description: null, coverUrl: null, createdAt: '', updatedAt: '' };
const document: ContentSummary = { ...video, contentId: 'document', contentType: 'document', title: '最近读过的讲义', durationSec: null, pageCount: 15 };
const props = { contents: [video, document], contentError: '', onRetryContents: vi.fn(), dueCount: 5, dueError: '', onRetryDue: vi.fn(), preview: false };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.exercises.mockResolvedValue({ total: 3, items: [] });
  mocks.progress.mockImplementation(async (id: string): Promise<Progress> => id === 'video' ? { contentType: 'video', positionSec: 247.5, lastStudiedAt: '2026-10-09T09:00:00Z' } : { contentType: 'document', page: 7, scrollRatio: 0.5, lastStudiedAt: '2026-10-10T09:00:00Z' });
  mocks.today.mockResolvedValue({ date: '2026-10-10', checkedIn: false, method: null, signedAt: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('prioritizes confirmed due review in DOM order and never treats a failed count as confirmed due work', async (): Promise<void> => {
  const view = render(<TodayLearningTasks {...props} />);
  await screen.findByText('上次读到第 7 页');
  expect(Array.from(view.container.querySelectorAll('article h3')).map((heading) => heading.textContent)).toEqual(['把学过的知识留下来', '接着上次的内容', '回到没弄懂的地方']);
  expect(screen.queryByRole('link', { name: '查看学习计划 →' })).toBeNull();
  view.rerender(<TodayLearningTasks {...props} dueCount={5} dueError="到期读取失败" />);
  expect(view.container.querySelector('article h3')?.textContent).toBe('接着上次的内容');
  expect(screen.queryByRole('link', { name: '开始复习 →' })).toBeNull();
});

it('resumes the most recently studied material and links due review and historical wrong questions', async () => {
  render(<TodayLearningTasks {...props} />);
  await screen.findByText('上次读到第 7 页');
  expect(screen.getByRole('link', { name: '继续学习 →' }).getAttribute('href')).toBe('/study/document');
  expect(screen.getByRole('link', { name: '开始复习 →' }).getAttribute('href')).toBe('/review');
  expect((await screen.findByRole('link', { name: '巩固错题 →' })).getAttribute('href')).toBe('/question-bank?status=wrong');
  expect(mocks.exercises).toHaveBeenCalledWith({ status: 'wrong', page: 1 });
});
it('distinguishes pending materials, empty tasks and actual zero counts', async () => {
  mocks.exercises.mockResolvedValue({ total: 0, items: [] });
  const view = render(<TodayLearningTasks {...props} contents={[{ ...video, status: '解析中' }]} dueCount={0} />);
  await screen.findByText('资料尚未就绪，请到学习中心查看解析状态。');
  expect(mocks.progress).not.toHaveBeenCalled();
  await screen.findByText('当前没有到期自测项，可以继续学习。');
  expect(screen.getByRole('link', { name: '进入题库 →' }).getAttribute('href')).toBe('/question-bank');
  view.rerender(<TodayLearningTasks {...props} contents={[]} dueCount={0} />);
  await screen.findByText('还没有学习资料，先导入一份吧。');
});
it('keeps failed reads distinct from empty data and retries wrong questions independently', async () => {
  mocks.exercises.mockRejectedValueOnce(new Error('offline'));
  render(<TodayLearningTasks {...props} contents={null} contentError="资料失败" dueCount={null} dueError="复习失败" />);
  await screen.findByText('错题数量暂时无法读取，请重试。');
  expect(screen.queryByText(/尚无错题记录/)).toBeNull();
  expect(screen.queryByText(/当前没有到期自测项/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载资料' })); expect(props.onRetryContents).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重新加载到期自测项' })); expect(props.onRetryDue).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重新加载错题' })); await screen.findByRole('link', { name: '巩固错题 →' });
  expect(mocks.progress).not.toHaveBeenCalled();
});
it('preserves a successful resume when another progress read fails and recovers invalid positions', async () => {
  mocks.progress.mockImplementation(async (id: string): Promise<Progress> => ({ contentType: 'video', positionSec: id === 'video' ? 247.5 : 9999, lastStudiedAt: '2026-10-10T09:00:00Z' }));
  render(<TodayLearningTasks {...props} />);
  await screen.findByText('上次看到 4:07'); expect(screen.getByRole('alert').textContent).toContain('部分续学位置');
  mocks.progress.mockResolvedValue({ contentType: 'video', positionSec: 0, lastStudiedAt: null });
  fireEvent.click(screen.getByRole('button', { name: '重新读取续学位置' }));
  await screen.findByText('尚无学习记录，可以从头开始');
  expect(screen.getByRole('link', { name: '开始学习 →' }).getAttribute('href')).toBe('/study/video');
});
it('ignores late progress from a replaced material list', async () => {
  let resolve!: (result: Progress) => void;
  mocks.progress.mockImplementationOnce(() => new Promise<Progress>((done) => { resolve = done; }));
  const view = render(<TodayLearningTasks {...props} contents={[video]} />);
  view.rerender(<TodayLearningTasks {...props} contents={[document]} />);
  await screen.findByText('上次读到第 7 页');
  await act(async () => resolve({ contentType: 'video', positionSec: 247, lastStudiedAt: '2026-10-11T09:00:00Z' }));
  expect(screen.getByRole('link', { name: '继续学习 →' }).getAttribute('href')).toBe('/study/document');
});
it('keeps the public preview explicitly exemplary and makes no authenticated reads', async () => {
  render(<TodayLearningTasks {...props} preview />);
  await screen.findByText(/以下为免登录示例数据/);
  expect(mocks.progress).not.toHaveBeenCalled(); expect(mocks.exercises).not.toHaveBeenCalled();
  expect(screen.getAllByRole('link').every((link) => link.getAttribute('href') === '/register')).toBe(true);
});
it('shows a compact unknown check-in state on failure and preserves ordinary check-in on explicit click', async () => {
  mocks.today.mockRejectedValueOnce(new Error('状态失败'));
  mocks.checkIn.mockResolvedValue({ date: '2026-10-10', checkedIn: true, method: 'manual', signedAt: '2026-10-10T08:01:00Z' });
  render(<DailyCheckInCard compact />);
  const card = screen.getByRole('region', { name: '今日打卡' });
  await within(card).findByText('今日状态未知');
  expect((within(card).getByRole('button', { name: '立即打卡' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.checkIn).not.toHaveBeenCalled();
  fireEvent.click(within(card).getByRole('button', { name: '重新读取状态' }));
  await waitFor(() => expect((within(card).getByRole('button', { name: '立即打卡' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(card).getByRole('button', { name: '立即打卡' }));
  await within(card).findByRole('button', { name: '今日已打卡' });
  expect(mocks.checkIn).toHaveBeenCalledTimes(1); expect(card.textContent).toContain('普通打卡');
});
