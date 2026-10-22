import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ scope: 'a', flashcards: vi.fn(), profile: vi.fn(), exercises: vi.fn(), content: vi.fn(), understanding: vi.fn(), generateExercise: vi.fn(), review: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('contentId=' + m.scope) }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactNode => createElement('main', null, children) }));
vi.mock('@/services/api', () => ({ api: m }));
import Review from '@/app/review/page';
import { useReviewSession } from '@/components/review/useReviewSession';
import { rarityFor } from '@/components/review/RarityBadge';
function card(id: string, contentId = id): { total: number; items: object[] } { return { total: 1, items: [{ flashcardId: id, contentId, pointId: 'p' + id, pointTitle: '知识点-' + id, contentTitle: '课程-' + contentId, front: id, back: '答案-' + id, nextReviewAt: '2026-01-01', easeFactor: 2.5, status: 'NEW', intervalDays: 0 }] }; }
beforeEach((): void => {
  vi.resetAllMocks(); m.scope = 'a';
  m.flashcards.mockImplementation(async (_due: boolean, id: string): Promise<ReturnType<typeof card>> => card(id));
  m.profile.mockResolvedValue({ xpTotal: 0, currentLevel: 'Lv.1', achievements: [] });
  m.exercises.mockResolvedValue({ total: 2, page: 1, pageSize: 10, items: [] });
  m.content.mockImplementation(async (id: string): Promise<object> => ({contentId:id,contentType:'document',status:'已就绪',pageCount:3,durationSec:null}));
  m.understanding.mockImplementation(async (id: string): Promise<object> => ({contentId:id,transcriptSegments:[],textBlocks:[{text:'真实原文',ref:{type:'document',page:2}}],knowledgePoints:[{pointId:'p'+id,title:'知识点-'+id,summary:'知识摘要',refs:[{type:'document',page:2}]}]}));
  m.review.mockResolvedValue({ xpGain: 10, newXpTotal: 10, newStreak: 1, levelUp: null, unlockedAchievements: [], nextReviewAt:'2026-10-14T00:00:00Z' });
});
afterEach((): void => cleanup());
it('resets the workspace and draft when the content scope changes', async (): Promise<void> => {
  const view = render(<Review />); await screen.findByText('a');
  fireEvent.change(screen.getByLabelText('我的回忆（可选，仅保留在本页）'),{target:{value:'旧范围草稿'}});
  m.scope = 'b'; view.rerender(<Review />);
  await screen.findByText('b'); expect(screen.queryByText('a')).toBeNull();
  expect((screen.getByLabelText('我的回忆（可选，仅保留在本页）') as HTMLTextAreaElement).value).toBe('');
});
it('ignores a late response from a previous content', async (): Promise<void> => {
  let finish!: (value: ReturnType<typeof card>) => void;
  m.flashcards.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<Review />); m.scope = 'b'; view.rerender(<Review />);
  await screen.findByText('b'); await act(async (): Promise<void> => { finish(card('late-a')); });
  expect(screen.queryByText('late-a')).toBeNull();
});
it('uses only existing exercises for the exact point and does not invoke AI', async (): Promise<void> => {
  render(<Review />); await screen.findByText('该知识点有 2 道已有题目。');
  expect(m.exercises).toHaveBeenCalledWith({ contentId:'a', pointId:'pa', page:1 });
  expect(screen.getByRole('link',{name:'练习这个知识点'}).getAttribute('href')).toBe('/question-bank?contentId=a&pointId=pa');
  expect(m.generateExercise).not.toHaveBeenCalled();
});
it('hides answer and sources until reveal and prevents premature rating', async (): Promise<void> => {
  render(<Review />); await screen.findByText('a');
  expect(screen.queryByText('答案-a')).toBeNull(); expect(m.content).not.toHaveBeenCalled();
  const rate = screen.getByRole('button',{name:'3 · 熟练'});
  expect((rate as HTMLButtonElement).disabled).toBe(true); fireEvent.click(rate); expect(m.review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'查看要点'}));
  await screen.findByText('答案-a'); await screen.findByRole('link',{name:'查看原文第 2 页'});
  expect((screen.getByRole('button',{name:'3 · 熟练'}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('核对后选择熟悉度，这是自评，不代表答题判分。')).toBeTruthy();
});
it('keeps per-card recall drafts while changing the selected item', async (): Promise<void> => {
  m.flashcards.mockResolvedValue({total:2,items:[...card('a1','a').items,...card('a2','a').items]});
  render(<Review />); await screen.findByText('a1');
  const input=screen.getByLabelText('我的回忆（可选，仅保留在本页）');
  fireEvent.change(input,{target:{value:'第一项草稿'}}); fireEvent.click(screen.getByRole('button',{name:'2. 知识点-a2 课程-a'}));
  expect((input as HTMLTextAreaElement).value).toBe(''); fireEvent.change(input,{target:{value:'第二项草稿'}});
  fireEvent.click(screen.getByRole('button',{name:'1. 知识点-a1 课程-a'})); expect((input as HTMLTextAreaElement).value).toBe('第一项草稿');
  await screen.findByText('该知识点有 2 道已有题目。');
});
it('rates the newly selected card by keyboard and ignores keys inside recall input', async (): Promise<void> => {
  m.flashcards.mockResolvedValue({ total: 2, items: [...card('a1', 'a').items, ...card('a2', 'a').items] });
  render(<Review />); await screen.findByText('a1');
  fireEvent.click(screen.getByRole('button', { name: '2. 知识点-a2 课程-a' }));
  fireEvent.keyDown(window, { code: 'Space', key: ' ' }); await screen.findByText('答案-a2');
  const input = screen.getByLabelText('我的回忆（可选，仅保留在本页）');
  fireEvent.change(input, { target: { value: '当前项草稿' } });
  fireEvent.keyDown(input, { key: '4' }); expect(m.review).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: '4' }); fireEvent.keyDown(window, { key: '4' });
  await waitFor((): void => { expect(m.review).toHaveBeenCalledTimes(1); });
  expect(m.review).toHaveBeenCalledWith('a2', 3);
  await screen.findByText('a1');
});
it('preserves draft and revealed answer after rating fails', async (): Promise<void> => {
  m.review.mockRejectedValueOnce(new Error('记录失败'));
  render(<Review />); await screen.findByText('a');
  fireEvent.change(screen.getByLabelText('我的回忆（可选，仅保留在本页）'),{target:{value:'我的草稿'}});
  fireEvent.click(screen.getByRole('button',{name:'查看要点'})); fireEvent.click(screen.getByRole('button',{name:'2 · 记住'}));
  await screen.findByText('记录失败'); expect(screen.getByText('答案-a')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '复习后下一步' })).toBeNull();
  expect((screen.getByLabelText('我的回忆（可选，仅保留在本页）') as HTMLTextAreaElement).value).toBe('我的草稿');
  expect(screen.getByText('本次已记录 0 / 1 项')).toBeTruthy(); expect(m.review).toHaveBeenCalledTimes(1);
});
it('retains successfully forgotten items and their real schedule after completing review', async (): Promise<void> => {
  m.review.mockResolvedValueOnce({ xpGain: 0, newXpTotal: 0, newStreak: 0, levelUp: null, nextReviewAt: '2026-10-14T00:00:00Z' });
  render(<Review />); await screen.findByText('a'); fireEvent.click(screen.getByRole('button', { name: '查看要点' }));
  fireEvent.click(screen.getByRole('button', { name: '0 · 忘记' })); await screen.findByText('本次复习完成');
  expect(screen.getAllByText('知识点-a · 自评忘记')).toHaveLength(2);
  expect(screen.getByRole('link', { name: '查看对应知识点练习' }).getAttribute('href')).toBe('/question-bank?contentId=a&pointId=pa');
  fireEvent.click(screen.getByText('本次记录与下次安排 · 1 项'));
  expect(screen.getByText(/下次安排：/).textContent).toContain('2026');
  expect(m.review).toHaveBeenCalledTimes(1); expect(m.generateExercise).not.toHaveBeenCalled();
});
it('prevents repeated rating and item changes while saving and shows the real next date', async (): Promise<void> => {
  let finish!: (value: object) => void;
  m.review.mockImplementation(() => new Promise((resolve) => { finish=resolve; }));
  m.flashcards.mockResolvedValue({total:2,items:[...card('a','a').items,...card('other','a').items]});
  render(<Review />); await screen.findByText('a'); fireEvent.click(screen.getByRole('button',{name:'查看要点'}));
  fireEvent.click(screen.getByRole('button',{name:'3 · 熟练'})); fireEvent.click(screen.getByRole('button',{name:'3 · 熟练'}));
  fireEvent.click(screen.getByRole('button',{name:'2. 知识点-other 课程-a'}));
  expect(m.review).toHaveBeenCalledTimes(1); expect(screen.getByText('a')).toBeTruthy();
  await act(async (): Promise<void> => { finish({xpGain:10,newXpTotal:10,newStreak:1,levelUp:null,nextReviewAt:'2026-10-14T00:00:00Z'}); });
  await screen.findByText('other'); expect(screen.getByText('本次已记录 1 / 2 项')).toBeTruthy();
  expect(screen.getByText(/下次复习：/)).toHaveProperty('textContent',expect.stringContaining('2026'));
});
it('distinguishes genuinely empty due list from completing the current session', async (): Promise<void> => {
  m.flashcards.mockResolvedValueOnce({total:0,items:[]}); const view=render(<Review />);
  await screen.findByText('暂无到期知识点'); expect(screen.queryByText('本次复习完成')).toBeNull(); view.unmount();
  render(<Review />); await screen.findByText('a'); fireEvent.click(screen.getByRole('button',{name:'查看要点'})); fireEvent.click(screen.getByRole('button',{name:'3 · 熟练'}));
  await screen.findByText('本次复习完成'); expect(screen.getByText('本次已记录 1 / 1 项')).toBeTruthy();
});
it('keeps absent exercises distinct from a failure and supports independent retry', async (): Promise<void> => {
  m.exercises.mockRejectedValueOnce(new Error('练习暂不可用')).mockResolvedValueOnce({total:0,items:[]});
  render(<Review />); await screen.findByText('练习暂不可用'); expect(screen.queryByText('该知识点暂无已有题目。')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重新加载关联练习'})); await screen.findByText('该知识点暂无已有题目。'); expect(m.generateExercise).not.toHaveBeenCalled();
});
it('shows profile errors with retry rather than an endless spinner', async (): Promise<void> => {
  m.profile.mockRejectedValueOnce(new Error('档案加载失败')); render(<Review />); await screen.findByRole('alert');
  expect(screen.queryByText('正在准备复习清单…')).toBeNull(); fireEvent.click(screen.getByText('重新加载复习')); await screen.findByText('a');
});
it('does not guess a source when its reference is unsupported', async (): Promise<void> => {
  m.understanding.mockResolvedValue({contentId:'a',transcriptSegments:[],textBlocks:[],knowledgePoints:[{pointId:'pa',title:'标题',summary:'摘要',refs:[{type:'document',page:2}]}]});
  render(<Review />); await screen.findByText('a'); fireEvent.click(screen.getByRole('button',{name:'查看要点'}));
  await screen.findByText('暂无可核对的时间点或页码，可回到原资料查看。'); expect(screen.queryByRole('link',{name:'查看原文第 2 页'})).toBeNull();
});
it('updates the visible level when a review levels up', (): void => {
  const { result } = renderHook(() => useReviewSession({ streak:0,xp:90,level:'Lv.1',todayProgress:{done:0,total:1} }));
  act((): void => result.current.applyReviewResponse({xpGain:10,newXpTotal:100,newStreak:1,levelUp:{from:'Lv.1',to:'Lv.2'}})); expect(result.current.level).toBe('Lv.2');
});
it('preserves existing card state classifications', (): void => { expect(rarityFor(2.5,'new')).toBe('confirm'); expect(rarityFor(2.5,'LEARNING')).toBe('confirm'); expect(rarityFor(2.5,'graduated')).toBe('mastered'); });
it('keeps one source panel and practice link after repeated reveal and rating', async (): Promise<void> => {
  const errors = vi.spyOn(console, 'error').mockImplementation((): void => undefined);
  m.flashcards.mockResolvedValue({ total: 2, items: [...card('a1', 'a').items, ...card('a2', 'a').items] });
  try {
    render(<Review />); await screen.findByText('a1');
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '查看要点' }));
      await screen.findByRole('region', { name: '知识点来源' });
      expect(screen.getAllByRole('link', { name: '练习这个知识点' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: '收起要点' }));
      expect(screen.queryByRole('region', { name: '知识点来源' })).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: '查看要点' }));
    fireEvent.click(screen.getByRole('button', { name: '1 · 模糊' }));
    await screen.findByText('a2');
    fireEvent.click(screen.getByRole('button', { name: '查看要点' }));
    await screen.findByRole('region', { name: '知识点来源' });
    expect(screen.getAllByRole('link', { name: '练习这个知识点' })).toHaveLength(1);
    expect(errors.mock.calls.some((args) => String(args[0]).includes('same key'))).toBe(false);
  } finally { errors.mockRestore(); }
});
