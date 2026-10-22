import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Understanding } from '@/services/api';

const m = vi.hoisted(() => ({ content: vi.fn(), understanding: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m }));
import { ExerciseSourcePanel } from '@/components/review/ExerciseSourcePanel';

function products(id = 'a'): Understanding {
  return { contentId: id, status: 'completed', transcriptSegments: [{ segmentId: 's', seq: 0, startMs: 12000, endMs: 13000, text: '真实转写' }], textBlocks: [], knowledgePoints: [{ pointId: 'p', title: '知识点', summary: '需巩固的摘要', tags: [], importance: 1, refs: [{ type: 'video', timestampSec: 12 }] }] };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.content.mockImplementation(async (id: string) => ({ contentId: id, contentType: 'video', durationSec: 120, pageCount: null, status: '已就绪' }));
  m.understanding.mockImplementation(async (id: string) => products(id));
});
afterEach(() => cleanup());

it('keeps the current question source when an old request finishes late', async () => {
  let finish!: (value: Understanding) => void;
  m.understanding.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<ExerciseSourcePanel key="a" contentId="a" pointId="p" correct={false} />);
  view.rerender(<ExerciseSourcePanel key="b" contentId="b" pointId="p" correct={false} />);
  expect((await screen.findByRole('link', { name: '回看视频 0:12' })).getAttribute('href')).toBe('/study/b?t=12');
  await act(async () => { finish(products('a')); });
  expect(screen.getByRole('link', { name: '回看视频 0:12' }).getAttribute('href')).toBe('/study/b?t=12');
});
it('allows a source retry after a failed read', async () => {
  m.understanding.mockRejectedValueOnce(new Error('读取失败'));
  render(<ExerciseSourcePanel contentId="a" pointId="p" correct={false} />);
  expect((await screen.findByRole('alert')).textContent).toContain('读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重新加载来源' }));
  await screen.findByRole('link', { name: '回看视频 0:12' });
});
it('does not borrow a similarly named point when the old point was replaced', async () => {
  render(<ExerciseSourcePanel contentId="a" pointId="deleted" correct={false} />);
  await screen.findByText(/关联知识点已不存在/);
  expect(screen.queryByText('需巩固的摘要')).toBeNull();
  expect(screen.queryByRole('link', { name: /回看视频/ })).toBeNull();
  expect(screen.getByRole('link', { name: '打开原资料' }).getAttribute('href')).toBe('/study/a');
});
it('shows a fallback instead of making up a missing time', async () => {
  const data = products(); data.knowledgePoints[0].refs = [];
  m.understanding.mockResolvedValue(data);
  render(<ExerciseSourcePanel contentId="a" pointId="p" correct={false} />);
  await screen.findByText(/暂无可核对的时间点或页码/);
  expect(screen.queryByRole('link', { name: /回看视频/ })).toBeNull();
});
it('rejects products from a different material', async () => {
  m.understanding.mockResolvedValue(products('other'));
  render(<ExerciseSourcePanel contentId="a" pointId="p" correct={false} />);
  expect((await screen.findByRole('alert')).textContent).toContain('资料来源不一致');
  expect(screen.queryByRole('link')).toBeNull();
});
it('links documents to actual pages and hides links before content is ready', async () => {
  const data = products(); data.transcriptSegments = []; data.textBlocks = [{ blockId: 'b', text: '原文', source: 'PDF', ref: { type: 'document', page: 2, blockIndex: 0 } }];
  data.knowledgePoints[0].refs = [{ type: 'document', page: 2 }];
  m.understanding.mockResolvedValue(data);
  m.content.mockResolvedValue({ contentId: 'a', contentType: 'document', durationSec: null, pageCount: 3, status: '已就绪' });
  const view = render(<ExerciseSourcePanel contentId="a" pointId="p" correct />);
  expect((await screen.findByRole('link', { name: '查看原文第 2 页' })).getAttribute('href')).toBe('/study/a?page=2');
  m.content.mockResolvedValue({ contentId: 'a', contentType: 'document', durationSec: null, pageCount: 3, status: '解析中' });
  view.rerender(<ExerciseSourcePanel key="pending" contentId="a" pointId="p" correct />);
  await screen.findByText('原资料尚未就绪，暂时无法回看。');
  expect(screen.queryByRole('link')).toBeNull();
});
