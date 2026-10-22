import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MasteryItem } from '@/services/api';

const m = vi.hoisted(() => ({ contents: vi.fn(), notes: vi.fn(), weakPoints: vi.fn(), profile: vi.fn(), mastery: vi.fn(), flashcards: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m }));
vi.mock('next/navigation', () => ({ usePathname: (): string => '/dashboard' }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactElement => createElement('main', null, children) }));
vi.mock('@/components/app/TodayLearningTasks', () => ({ TodayLearningTasks: (): null => null }));
vi.mock('@/components/app/DailyCheckInCard', () => ({ DailyCheckInCard: (): null => null }));
vi.mock('@/components/app/PlanReminders', () => ({ PlanReminders: (): null => null }));
import Dashboard from '@/app/dashboard/page';

function card(label: string): HTMLElement { return within(screen.getByRole('region', { name: '学习概览' })).getByText(label).closest('article')!; }
function responseGate<T>(): { promise: Promise<T>; resolve: (result: T) => void } {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done): void => { resolve = done; });
  return { promise, resolve };
}
beforeEach((): void => {
  vi.resetAllMocks(); m.contents.mockResolvedValue({ items: [{ contentId: 'a', title: '资料 A', status: '已就绪', contentType: 'video' }, { contentId: 'b', title: '资料 B', status: '已就绪', contentType: 'video' }] });
  m.notes.mockResolvedValue({ items: [] }); m.weakPoints.mockResolvedValue({ items: [] }); m.profile.mockResolvedValue({ xpTotal: 0, currentLevel: 'Lv.1 · 新手' }); m.mastery.mockResolvedValue({ items: [] }); m.flashcards.mockResolvedValue({ total: 0 });
});
afterEach(cleanup);

it('prioritizes import and opens guidance only for a confirmed empty library', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [] });
  render(<Dashboard />);
  const link = await screen.findByRole('link', { name: '导入第一份资料 →' });
  expect(link.getAttribute('href')).toBe('/import');
  expect(screen.getByRole('button', { name: '收起新手指引' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '新手学习指引' })).toBeTruthy();
});

it('does not claim an unknown or failed library is an empty first-use account', async (): Promise<void> => {
  m.contents.mockRejectedValue(new Error('失败'));
  render(<Dashboard />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('link', { name: '导入第一份资料 →' })).toBeNull();
  expect(screen.queryByRole('region', { name: '新手学习指引' })).toBeNull();
});
it('uses the task section as the main action rather than duplicating review and keeps cumulative labels explicit', async (): Promise<void> => {
  render(<Dashboard />); await screen.findByText('资料 A');
  expect(screen.getByRole('link', { name: '选择下一步 →' }).getAttribute('href')).toBe('#today-tasks-title');
  expect(screen.queryByRole('link', { name: '开始今日复习 →' })).toBeNull();
  expect(screen.queryByText('累计 XP')).toBeNull(); expect(m.profile).not.toHaveBeenCalled();
});
it('does not describe zero weaknesses as work to prioritize when due review exists', async (): Promise<void> => {
  m.flashcards.mockResolvedValue({ total: 2 });
  render(<Dashboard />);
  await screen.findByText('你有 2 项自测等待复习。');
  expect(screen.queryByText(/0 个薄弱点值得优先补强/)).toBeNull();
});

it('does not turn pending statistics into zero or empty records', async (): Promise<void> => {
  const pending = new Promise<never>(() => undefined); m.notes.mockReturnValue(pending); m.profile.mockReturnValue(pending); m.mastery.mockReturnValue(pending); m.weakPoints.mockReturnValue(pending);
  render(<Dashboard />); await screen.findByText('资料 A');
  for (const label of ['笔记', '知识点掌握']) expect(card(label).querySelector('strong')!.textContent).toBe('—');
  expect(screen.getByText('正在读取薄弱点…')).toBeTruthy(); expect(screen.queryByText('暂无掌握度记录')).toBeNull(); expect(screen.queryByText('Lv.1 · 新手')).toBeNull();
});

it('keeps a recorded 0% distinct from an absence of mastery records', async (): Promise<void> => {
  // 统计独立返回：掌握度先完成，不能据此推断账号或全部笔记已返回。
  const firstNotes = responseGate<{ items: unknown[] }>();
  const secondNotes = responseGate<{ items: unknown[] }>();
  const profile = responseGate<{ xpTotal: number; currentLevel: string }>();
  m.notes.mockImplementation((id: string): Promise<{ items: unknown[] }> => id === 'a' ? firstNotes.promise : secondNotes.promise);
  m.profile.mockReturnValue(profile.promise);
  m.mastery.mockResolvedValue({ items: [{ score: 0 }] }); render(<Dashboard />);
  await screen.findAllByText('0%'); expect(card('知识点掌握').querySelector('strong')!.textContent).toBe('0%');
  expect(card('笔记').querySelector('strong')!.textContent).toBe('—'); expect(screen.queryByText('累计 XP')).toBeNull();
  await act(async (): Promise<void> => { profile.resolve({ xpTotal: 0, currentLevel: 'Lv.1 · 新手' }); });
  expect(m.profile).not.toHaveBeenCalled(); expect(card('笔记').querySelector('strong')!.textContent).toBe('—');
  await act(async (): Promise<void> => { firstNotes.resolve({ items: [] }); });
  expect(card('笔记').querySelector('strong')!.textContent).toBe('—');
  await act(async (): Promise<void> => { secondNotes.resolve({ items: [] }); });
  await within(card('笔记')).findByText('0');
  expect(screen.queryByText('暂无掌握度记录')).toBeNull(); cleanup(); m.mastery.mockResolvedValue({ items: [] }); render(<Dashboard />);
  await screen.findAllByText('暂无掌握度记录'); expect(card('知识点掌握').querySelector('strong')!.textContent).toBe('—');
});

it('does not present a partial note count as a total and retries only notes', async (): Promise<void> => {
  m.notes.mockImplementation(async (id: string): Promise<{ items: unknown[] }> => { if (id === 'b') throw new Error('失败'); return { items: [{ noteId: 'n' }] }; });
  render(<Dashboard />); await screen.findByRole('button', { name: '重试笔记' }); expect(card('笔记').querySelector('strong')!.textContent).toBe('—');
  const calls = m.contents.mock.calls.length; m.notes.mockResolvedValue({ items: [] }); fireEvent.click(screen.getByRole('button', { name: '重试笔记' }));
  await within(card('笔记')).findByText('0'); expect(m.contents).toHaveBeenCalledTimes(calls); expect(m.profile).not.toHaveBeenCalled(); expect(m.mastery).toHaveBeenCalledTimes(1);
});

it('provides independent mastery and weakness retries without a duplicate profile read', async (): Promise<void> => {
  m.profile.mockRejectedValueOnce(new Error('失败')); m.mastery.mockRejectedValueOnce(new Error('失败')); m.weakPoints.mockRejectedValueOnce(new Error('失败'));
  render(<Dashboard />); await screen.findByRole('button', { name: '重试知识点掌握' });
  expect(screen.queryByText('累计 XP')).toBeNull(); expect(card('知识点掌握').querySelector('strong')!.textContent).toBe('—');
  expect(m.profile).not.toHaveBeenCalled(); expect(m.mastery).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试知识点掌握' })); await screen.findAllByText('暂无掌握度记录'); expect(m.weakPoints).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试薄弱点' })); await screen.findByText(/完成几次复习后/);
});

it('ignores a statistics response after unmount rather than replacing the new page state', async (): Promise<void> => {
  let finish!: (result: { items: MasteryItem[] }) => void;
  m.mastery.mockImplementationOnce(() => new Promise<{ items: MasteryItem[] }>((resolve) => { finish = resolve; }));
  const view = render(<Dashboard />); view.unmount(); render(<Dashboard />); await screen.findAllByText('暂无掌握度记录');
  await act(async (): Promise<void> => { finish({ items: [{ score: 1 } as MasteryItem] }); }); expect(screen.queryByText('100%')).toBeNull();
});
