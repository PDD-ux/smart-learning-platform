import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ content: vi.fn(), resource: vi.fn(), understanding: vi.fn(), notes: vi.fn(), progress: vi.fn(), understandingStatus: vi.fn(), generatedNote: vi.fn(), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(), saveProgress: vi.fn() }));
const navigation = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'c' }), useRouter: () => navigation.router }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('main', null, children) }));
vi.mock('@/services/api', () => ({ api: m, ApiClientError: class extends Error {} }));
import Study from '@/app/study/[id]/page';
const note = { noteId: 'n', contentId: 'c', content: '原笔记', ref: { type: 'video', timestampSec: 12 }, version: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  m.content.mockResolvedValue({ contentId: 'c', contentType: 'video', title: '测试课程', durationSec: 120, status: '已就绪' });
  m.resource.mockResolvedValue({ contentType: 'video', format: 'MP4', url: '/video' });
  m.understanding.mockResolvedValue({ knowledgePoints: [], textBlocks: [], transcriptSegments: [] });
  m.notes.mockResolvedValue({ items: [note] }); m.progress.mockResolvedValue({ contentType: 'video', positionSec: 0 });
  m.understandingStatus.mockResolvedValue({ phase: 'completed' }); m.generatedNote.mockResolvedValue({ note: null });
  m.createNote.mockImplementation(async (_id: string, body: { content: string; ref: object }) => ({ ...note, ...body, noteId: 'created' }));
  m.updateNote.mockImplementation(async (_id: string, body: { content: string }) => ({ ...note, ...body, version: 2 }));
  m.saveProgress.mockResolvedValue({}); m.deleteNote.mockResolvedValue({ deleted: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function open(): Promise<HTMLTextAreaElement> {
  render(<Study />); await screen.findByRole('button', { name: '我的笔记' });
  fireEvent.click(screen.getByRole('button', { name: '我的笔记' }));
  const input = screen.getByPlaceholderText('记录此刻的理解，停止输入 1 秒后自动保存…') as HTMLTextAreaElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}
it('retains edited text and edit mode after a failed update, allowing retry', async () => {
  await open(); fireEvent.click(screen.getByText('编辑'));
  m.updateNote.mockRejectedValueOnce(new Error('保存失败'));
  fireEvent.change(screen.getByPlaceholderText('修改笔记内容…'), { target: { value: '本次修改不能丢失' } });
  fireEvent.click(screen.getByText('保存修改'));
  await screen.findByText('保存失败');
  expect((screen.getByPlaceholderText('修改笔记内容…') as HTMLTextAreaElement).value).toBe('本次修改不能丢失');
  fireEvent.click(screen.getByText('保存修改'));
  await screen.findByText('本次修改不能丢失'); expect(m.updateNote).toHaveBeenCalledTimes(2); expect(m.createNote).not.toHaveBeenCalled();
});
it('does not duplicate a note when manual save overlaps pending autosave', async () => {
  const input = await open(); vi.useFakeTimers();
  let finish!: (value: object) => void;
  m.createNote.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.change(input, { target: { value: '一条笔记' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  fireEvent.click(screen.getByText('立即保存'));
  expect(m.createNote).toHaveBeenCalledTimes(1); expect(input.disabled).toBe(true);
  await act(async () => { finish({ ...note, noteId: 'new', content: '一条笔记' }); });
  expect(input.disabled).toBe(false);
});
it('anchors the draft to first input rather than the later playback position', async () => {
  const input = await open(); const video = document.querySelector('video')!;
  video.currentTime = 12; fireEvent.change(input, { target: { value: '定位笔记' } });
  video.currentTime = 38; fireEvent.click(screen.getByText('立即保存'));
  await waitFor(() => expect(m.createNote).toHaveBeenCalledWith('c', { content: '定位笔记', ref: { type: 'video', timestampSec: 12 } }));
});
it('does not retry a failed autosave indefinitely and retains the draft', async () => {
  const input = await open(); vi.useFakeTimers(); m.createNote.mockRejectedValue(new Error('网络断开'));
  fireEvent.change(input, { target: { value: '保留草稿' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(m.createNote).toHaveBeenCalledTimes(1); expect(input.value).toBe('保留草稿');
});
