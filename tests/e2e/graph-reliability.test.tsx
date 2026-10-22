import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ weakPoints: vi.fn(), mastery: vi.fn(), contents: vi.fn(), contentGraph: vi.fn(), graphOverview: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('main', null, children) }));
vi.mock('@/components/graph/GraphCanvas', () => ({ GraphCanvas: ({ graph, onNodeClick }: { graph: { nodes: { pointId: string; title: string }[] }; onNodeClick: (id: string) => void }) => createElement('div', null, graph.nodes.map((node) => createElement('button', { key: node.pointId, onClick: () => onNodeClick(node.pointId) }, node.title))) }));
import GraphPage from '@/app/graph/page';

const node = { pointId: 'p', title: '局部知识点', nodeType: 'concept', mastery: 0.5, isWeak: true, reviewCount: 1, correctRate: null, relatedNoteCount: 0, relatedFlashcardCount: 1, lastReviewedAt: null };
beforeEach(() => {
  vi.resetAllMocks();
  m.weakPoints.mockResolvedValue({ items: [] });
  m.mastery.mockResolvedValue({ items: [{ pointId: 'p', title: '知识点', score: 0.75, isWeak: false, reviewCount: 1, correctRate: null }] });
  m.contents.mockResolvedValue({ items: [{ contentId: 'c', title: '课程一' }, { contentId: 'd', title: '课程二' }] });
  m.graphOverview.mockResolvedValue({ nodes: [], edges: [] });
  m.contentGraph.mockResolvedValue({ nodes: [node], edges: [] });
});
afterEach(cleanup);

it('shows recorded zero mastery with an empty score bar rather than a minimum invented percent', async (): Promise<void> => {
  m.mastery.mockResolvedValue({ items: [{ pointId: 'p', title: '零掌握度', score: 0, isWeak: true, reviewCount: 1, correctRate: 0 }] });
  m.weakPoints.mockResolvedValue({ items: [{ pointId: 'p', title: '零掌握度', score: 0, tags: [], contentId: 'c', contentTitle: '课程一', relatedFlashcardCount: 0, lastReviewAt: null }] });
  render(<GraphPage />); fireEvent.click(screen.getByRole('tab', { name: '需要巩固' }));
  await screen.findAllByText('0%'); expect(screen.queryByText(/暂无掌握度记录/)).toBeNull();
  const item = screen.getByRole('heading', { name: '零掌握度' }).closest('article')!;
  expect(item.querySelector<HTMLElement>('[style]')!.style.width).toBe('0%');
});

it('retries graph failure without presenting it as a successful zero-node graph', async () => {
  m.graphOverview.mockRejectedValueOnce(new Error('图谱网络断开'));
  render(<GraphPage />);
  await screen.findByText('图谱网络断开');
  expect(screen.queryByText('0 个知识点')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载知识图谱' }));
  await screen.findByText('0 个知识点');
  expect(m.graphOverview).toHaveBeenCalledTimes(2);
});

it('does not display a failed mastery request as zero percent, and can retry', async () => {
  m.mastery.mockRejectedValueOnce(new Error('掌握度网络断开'));
  render(<GraphPage />);
  await screen.findByText('掌握度网络断开');
  expect(screen.queryByText('0%')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试掌握度' }));
  await screen.findByText('75%');
});

it('distinguishes weak-point failure from empty success and suppresses the review action', async () => {
  m.weakPoints.mockRejectedValueOnce(new Error('薄弱点网络断开'));
  render(<GraphPage />);
  await screen.findByText('薄弱点网络断开');
  fireEvent.click(screen.getByRole('tab', { name: '需要巩固' }));
  expect(screen.queryByText(/当前筛选下暂无薄弱点/)).toBeNull();
  expect(screen.queryByRole('link', { name: '一键进入薄弱点复习' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载看板数据' }));
  await screen.findByText(/当前筛选下暂无薄弱点/);
});

it('provides the current content source link for a local graph node', async () => {
  render(<GraphPage />);
  await screen.findByRole('option', { name: '课程一' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c' } });
  fireEvent.click(await screen.findByRole('button', { name: /^局部知识点/ }));
  expect(screen.getByRole('link', { name: /打开「课程一」/ }).getAttribute('href')).toBe('/study/c');
  expect(screen.getByRole('link', { name: '练习这个知识点' }).getAttribute('href')).toBe('/question-bank?contentId=c&pointId=p');
  expect(screen.getByRole('link', { name: '复习该资料到期项' }).getAttribute('href')).toBe('/review?contentId=c');
});

it('does not call an unrecorded graph default zero a measured weakness', async (): Promise<void> => {
  m.contentGraph.mockResolvedValue({ nodes: [{ ...node, mastery: 0, reviewCount: 0, correctRate: null, lastReviewedAt: null, isWeak: false }], edges: [] });
  m.mastery.mockResolvedValue({ items: [] });
  render(<GraphPage />); await screen.findByRole('option', { name: '课程一' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c' } });
  fireEvent.click(await screen.findByRole('button', { name: /^局部知识点/ }));
  expect(screen.getByText('概念 · 暂无学习记录')).toBeTruthy();
  expect(screen.queryByText('0%')).toBeNull();
});

it('keeps merged-node practice scoped to each source rather than guessing point-to-content mapping', async (): Promise<void> => {
  m.graphOverview.mockResolvedValue({ nodes: [{ ...node, pointIds: ['p', 'other'], contentIds: ['c', 'd'], aliases: [], weakPointCount: 1 }], edges: [] });
  render(<GraphPage />); fireEvent.click(await screen.findByRole('button', { name: /^局部知识点/ }));
  expect(screen.queryByRole('link', { name: '练习这个知识点' })).toBeNull();
  expect(screen.getAllByRole('link', { name: '查看该资料题库' }).map((link) => link.getAttribute('href'))).toEqual(['/question-bank?contentId=c', '/question-bank?contentId=d']);
  expect(screen.getByText(/这是跨资料合并知识点/)).toBeTruthy();
});

it('does not replace the new scope with a late graph response', async () => {
  let finish!: (graph: object) => void;
  m.contentGraph.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ nodes: [{ ...node, pointId: 'new', title: '新范围节点' }], edges: [] });
  render(<GraphPage />);
  await screen.findByRole('option', { name: '课程一' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'd' } });
  await screen.findByRole('button', { name: /^新范围节点/ });
  await act(async () => { finish({ nodes: [node], edges: [] }); });
  expect(screen.queryByRole('button', { name: /^局部知识点/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^新范围节点/ })).toBeTruthy();
});

it('makes a failed material selector explicit and restores it after retry', async () => {
  m.contents.mockRejectedValueOnce(new Error('资料列表网络断开'));
  render(<GraphPage />);
  await screen.findByText('资料列表网络断开');
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载看板数据' }));
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
  expect(screen.getByRole('option', { name: '课程一' })).toBeTruthy();
});

it('shows absent mastery records as unrecorded rather than a measured zero', async () => {
  m.mastery.mockResolvedValue({ items: [] });
  render(<GraphPage />);
  await screen.findByText('暂无掌握度记录，完成复习或练习后会更新。');
  expect(screen.queryByText('0%')).toBeNull();
});
