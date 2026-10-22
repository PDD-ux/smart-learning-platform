vi.mock('@/services/books',()=>({books:{read:vi.fn(async():Promise<object>=>({book:null})),write:vi.fn()}}));
import { StrictMode, createElement, type ReactElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Understanding } from '@/services/api';

const m = vi.hoisted(() => ({ content: vi.fn(), resource: vi.fn(), understanding: vi.fn(), notes: vi.fn(), progress: vi.fn(), understandingStatus: vi.fn(), generatedNote: vi.fn(), createNote: vi.fn(), saveProgress: vi.fn(), regenerateGeneratedNote: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const watched = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/services/watched-notes', () => ({ generateWatchedNote: watched.generate }));
vi.mock('next/navigation', () => ({ useParams: (): { id: string } => ({ id: 'c' }), useRouter: (): typeof router => router }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactElement => createElement('main', null, children) }));
vi.mock('@/services/api', () => ({ api: m, ApiClientError: class extends Error {} }));
import StudyPage from '@/app/study/[id]/page';

it('retains an existing watched batch and its saved state through shortcut navigation', async (): Promise<void> => {
  const source = { segmentId: 'seen', seq: 0, startMs: 0, endMs: 10000, text: '实际观看来源' };
  m.progress.mockResolvedValue({ contentType: 'video', positionSec: 0 });
  m.understanding.mockResolvedValue({ ...understanding, transcriptSegments: [source] });
  watched.generate.mockResolvedValue({ markdown: '随看批次仍保留', sources: [source], generatedAt: '2026-10-14T00:00:00Z', mode: 'source-extract' });
  const video = await open(); fireEvent.loadedMetadata(video); fireEvent.play(video);
  for (let seconds = 1; seconds <= 30; seconds += 1) { video.currentTime = seconds; fireEvent.timeUpdate(video); }
  await screen.findByText('随看批次仍保留');
  fireEvent.click(screen.getByRole('button', { name: '打开我的笔记' }));
  fireEvent.click(screen.getByRole('button', { name: '打开预解析重点' }));
  fireEvent.click(screen.getByRole('button', { name: '随看笔记' }));
  expect(screen.getByText('随看批次仍保留')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存到我的笔记' }));
  await screen.findByRole('button', { name: '已保存到我的笔记' });
  fireEvent.click(screen.getByRole('button', { name: '打开我的笔记' }));
  fireEvent.click(screen.getByRole('button', { name: '随看笔记' }));
  expect(screen.getByRole('button', { name: '已保存到我的笔记' }).hasAttribute('disabled')).toBe(true);
  expect(watched.generate).toHaveBeenCalledTimes(1); expect(m.createNote).toHaveBeenCalledTimes(1);
  expect(document.querySelector('video')).toBe(video); expect(video.currentTime).toBe(30);
});

it('exposes note shortcuts without replacing the player, clearing drafts or generating content', async (): Promise<void> => {
  const video = await open(); fireEvent.loadedMetadata(video);
  fireEvent.click(screen.getByRole('button', { name: '打开预解析重点' }));
  expect(detail('预解析重点与个人补充').open).toBe(true);
  fireEvent.change(screen.getByLabelText('补充我的笔记'), { target: { value: '仍未保存的同步补充' } });
  fireEvent.click(screen.getByRole('button', { name: '打开我的笔记' }));
  const draft = screen.getByPlaceholderText('记录此刻的理解，停止输入 1 秒后自动保存…');
  fireEvent.change(draft, { target: { value: '仍未保存的个人输入' } });
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理笔记' }));
  fireEvent.click(screen.getByRole('button', { name: '随看笔记' }));
  fireEvent.click(screen.getByRole('button', { name: '打开我的笔记' }));
  expect((draft as HTMLTextAreaElement).value).toBe('仍未保存的个人输入');
  expect((screen.getByLabelText('补充我的笔记') as HTMLTextAreaElement).value).toBe('仍未保存的同步补充');
  expect(document.querySelector('video')).toBe(video); expect(video.currentTime).toBe(247);
  expect(m.createNote).not.toHaveBeenCalled(); expect(m.regenerateGeneratedNote).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '练习此资料 →' }).getAttribute('href')).toBe('/question-bank?contentId=c');
  expect(screen.getByRole('link', { name: '安排学习计划 →' }).getAttribute('href')).toBe('/study-plans?contentId=c');
  expect(screen.queryByRole('link', { name: /讨论/ })).toBeNull();
});

it('does not show video-only tools for documents and opens the existing parsed note panel', async (): Promise<void> => {
  m.content.mockResolvedValue({ contentId: 'c', contentType: 'document', title: '课件', status: '已就绪', pageCount: 1 });
  m.resource.mockResolvedValue({ contentType: 'document', format: 'PNG', url: '/document-image' });
  m.progress.mockResolvedValue({ contentType: 'document', page: 1, scrollRatio: 0 });
  render(<StudyPage />); await screen.findByText('完整AI笔记');
  expect(screen.queryByRole('button', { name: '随看笔记' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开我的笔记' }));
  fireEvent.click(screen.getByRole('button', { name: '打开预解析重点' }));
  expect(screen.getByText('完整AI笔记')).toBeTruthy(); expect(document.querySelector('video')).toBeNull();
});

const understanding: Understanding = { contentId: 'c', status: 'completed', knowledgePoints: [{ pointId: 'p', title: '课程重点', summary: '重点摘要', tags: [], importance: 5, refs: [{ type: 'video', timestampSec: 240 }] }], transcriptSegments: [{ segmentId: 's', seq: 0, startMs: 240000, endMs: 260000, text: '原文片段' }], textBlocks: [{ blockId: 'b', ref: { type: 'video', timestampSec: 250 }, text: 'OCR画面文字', source: 'FRAME' }] };
beforeEach((): void => {
  vi.resetAllMocks(); m.content.mockResolvedValue({ contentId: 'c', contentType: 'video', title: '测试课程', durationSec: 1800, status: '已就绪' });
  m.resource.mockResolvedValue({ contentType: 'video', format: 'MP4', url: '/video' }); m.understanding.mockResolvedValue(understanding);
  m.notes.mockResolvedValue({ items: [] }); m.progress.mockResolvedValue({ contentType: 'video', positionSec: 247 });
  m.understandingStatus.mockResolvedValue({ phase: 'completed' }); m.generatedNote.mockResolvedValue({ note: { markdown: '完整AI笔记', sourceCount: 1 } });
  m.createNote.mockResolvedValue({ noteId: 'n', contentId: 'c', content: '补充草稿', ref: { type: 'video', timestampSec: 247 }, version: 1 }); m.saveProgress.mockResolvedValue({});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach((): void => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function open(): Promise<HTMLVideoElement> { render(<StudyPage />); await screen.findByText('完整AI笔记'); return document.querySelector('video')!; }

it('does not report restored paused position as study activity, but reports actual playback', async (): Promise<void> => {
  const video = await open(); fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(247);
  fireEvent.timeUpdate(video); fireEvent.pause(video);
  expect(m.saveProgress).not.toHaveBeenCalled();
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  fireEvent.play(video); video.currentTime = 248; fireEvent.timeUpdate(video);
  await waitFor((): void => { expect(m.saveProgress).toHaveBeenCalledWith('c', { contentType: 'video', positionSec: 248 }); });
});
function detail(title: string): HTMLDetailsElement { return screen.getByText(title, { selector: 'summary' }).closest('details') as HTMLDetailsElement; }

it('places media and synchronized notes before full notes and keeps secondary sections closed', async (): Promise<void> => {
  const video = await open(); const panel = screen.getByRole('region', { name: '播放同步笔记' }); const notes = screen.getByRole('region', { name: '完整笔记' });
  expect(screen.getByRole('heading', { level: 1, name: '测试课程' })).toBeTruthy();
  expect(screen.getByText('视频 · 已就绪')).toBeTruthy();
  expect(video.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(panel.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(detail('查看处理详情').open).toBe(false);
  expect(screen.getByText(/转写段落/, { selector: 'summary' }).closest('details')!.open).toBe(false);
  expect(screen.getByText(/画面文字 \/ OCR/, { selector: 'summary' }).closest('details')!.open).toBe(false);
  expect(await within(panel).findByText('原文片段')).toBeTruthy();
  expect(m.regenerateGeneratedNote).not.toHaveBeenCalled();
});

it('retains the same media element and saved position when details are opened and closed', async (): Promise<void> => {
  const video = await open(); fireEvent.loadedMetadata(video); expect(video.currentTime).toBe(247);
  const summary = screen.getByText(/画面文字 \/ OCR/, { selector: 'summary' });
  fireEvent.click(summary); expect(summary.closest('details')!.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /OCR画面文字/ }));
  expect(video.currentTime).toBe(250); expect(video.play).toHaveBeenCalledTimes(1);
  fireEvent.click(summary); expect(summary.closest('details')!.open).toBe(false);
  expect(document.querySelector('video')).toBe(video); expect(video.currentTime).toBe(250);
});

it('preserves synchronized-note draft and anchor through folding, tab switches and failed saves', async (): Promise<void> => {
  const video = await open(); fireEvent.loadedMetadata(video);
  fireEvent.change(screen.getByLabelText('补充我的笔记'), { target: { value: '补充草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '我的笔记' }));
  fireEvent.click(screen.getByText('查看处理详情', { selector: 'summary' }));
  fireEvent.click(screen.getByText('查看处理详情', { selector: 'summary' }));
  video.currentTime = 300; fireEvent.seeking(video);
  m.createNote.mockRejectedValueOnce(new Error('保存暂时失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存补充' }));
  await screen.findByText(/保存暂时失败/);
  expect((screen.getByLabelText('补充我的笔记') as HTMLTextAreaElement).value).toBe('补充草稿');
  fireEvent.click(screen.getByRole('button', { name: '保存补充' })); await screen.findByText('已保存到我的笔记');
  expect(m.createNote).toHaveBeenLastCalledWith('c', { content: '补充草稿', ref: { type: 'video', timestampSec: 247 } });
  expect(m.createNote).toHaveBeenCalledTimes(2);
});

it('continues processing polling while closed and shows a failure outside the details', async (): Promise<void> => {
  m.understandingStatus.mockResolvedValueOnce({ phase: 'deep-extract' }).mockResolvedValueOnce({ phase: 'failed', failureReason: '转写服务不可用' });
  vi.useFakeTimers();
  await act(async (): Promise<void> => { render(<StudyPage />); });
  await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(3000); });
  const alert = screen.getByRole('alert'); expect(alert.textContent).toContain('转写服务不可用');
  expect(alert.closest('details')).toBeNull(); expect(detail('查看处理详情').open).toBe(false);
  expect(m.understandingStatus).toHaveBeenCalledTimes(2); expect(document.querySelector('video')).toBeTruthy();
});

it('keeps citation navigation ahead of saved playback and retains the manual draft on reload', async (): Promise<void> => {
  m.resource.mockRejectedValueOnce(new Error('资源断开'));
  render(<StudyPage searchParams={{ t: '240' }} />); await screen.findByText('完整AI笔记');
  fireEvent.click(screen.getByRole('button', { name: '我的笔记' }));
  const input = screen.getByPlaceholderText('记录此刻的理解，停止输入 1 秒后自动保存…') as HTMLTextAreaElement;
  vi.useFakeTimers(); fireEvent.change(input, { target: { value: '不能丢失的草稿' } });
  await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: '重新加载资料' })); });
  expect(input.value).toBe('不能丢失的草稿');
  const video = document.querySelector('video')!; fireEvent.loadedMetadata(video); expect(video.currentTime).toBe(240);
  expect(m.createNote).not.toHaveBeenCalled();
});

it('preserves document text-block page navigation after expansion', async (): Promise<void> => {
  m.content.mockResolvedValue({ contentId: 'c', contentType: 'document', title: '文档课程', pageCount: 3, status: '已就绪' });
  m.resource.mockResolvedValue({ contentType: 'document', format: 'PDF', url: '/pdf', pageCount: 3 });
  m.progress.mockResolvedValue({ contentType: 'document', page: 1, scrollRatio: 0 });
  m.understanding.mockResolvedValue({ ...understanding, transcriptSegments: [], knowledgePoints: [], textBlocks: [{ blockId: 'b', ref: { type: 'document', page: 2 }, text: '文档OCR文字', source: 'ocr' }] });
  render(<StudyPage />); await screen.findByText('完整AI笔记');
  fireEvent.click(screen.getByText(/文本块 \/ OCR/, { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: /文档OCR文字/ }));
  await waitFor(() => expect(m.saveProgress).toHaveBeenCalledWith('c', { contentType: 'document', page: 2, scrollRatio: 0 }));
  expect(screen.getByAltText('文档课程 第 2 页')).toBeTruthy();
});

it('keeps pending and failed understanding distinct from zero evidence, with independent retry', async (): Promise<void> => {
  const pending = new Promise<never>(() => undefined); m.understanding.mockReturnValueOnce(pending);
  const video = await open(); const panel = screen.getByRole('region', { name: '播放同步笔记' });
  expect(within(panel).getByRole('button', { name: '全部重点 · —' })).toBeTruthy();
  expect(within(panel).queryByText(/暂无带视频时间/)).toBeNull(); expect(screen.getByText(/转写段落/, { selector: 'summary' }).textContent).not.toContain('0 段');
  cleanup(); m.understanding.mockRejectedValueOnce(new Error('断开')); render(<StudyPage />); await screen.findByRole('button', { name: '重试解析依据' });
  const sameVideo = document.querySelector('video')!; fireEvent.loadedMetadata(sameVideo);
  fireEvent.change(screen.getByLabelText('补充我的笔记'), { target: { value: '保留同步草稿' } });
  const resourceCalls = m.resource.mock.calls.length; const progressCalls = m.progress.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '重试解析依据' })); await screen.findByRole('button', { name: '全部重点 · 1' });
  expect(document.querySelector('video')).toBe(sameVideo); expect((screen.getByLabelText('补充我的笔记') as HTMLTextAreaElement).value).toBe('保留同步草稿');
  expect(m.resource).toHaveBeenCalledTimes(resourceCalls); expect(m.progress).toHaveBeenCalledTimes(progressCalls); expect(video).not.toBe(sameVideo);
});

it('separates a failed AI-note read from a genuine absence and preserves the manual draft on retry', async (): Promise<void> => {
  m.generatedNote.mockRejectedValueOnce(new Error('读取断开')); render(<StudyPage />);
  fireEvent.click(await screen.findByRole('button', { name: '我的笔记' })); vi.useFakeTimers();
  const input = screen.getByPlaceholderText('记录此刻的理解，停止输入 1 秒后自动保存…') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '我的输入' } });
  m.generatedNote.mockResolvedValueOnce({ note: null }); await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: '重试AI 笔记' })); });
  expect(input.value).toBe('我的输入'); expect(m.resource).toHaveBeenCalledTimes(1); expect(m.createNote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理笔记' })); expect(screen.getByText('暂无已保存的 AI 笔记')).toBeTruthy(); expect(screen.queryByText('等待解析')).toBeNull();
});

it('does not overwrite a saved position while its read is pending or failed', async (): Promise<void> => {
  m.progress.mockRejectedValueOnce(new Error('位置断开')); const video = await open();
  await screen.findByRole('button', { name: '重试续学位置' }); Object.defineProperty(video, 'readyState', { configurable: true, value: 1 }); fireEvent.loadedMetadata(video); fireEvent.timeUpdate(video); fireEvent.pause(video);
  expect(m.saveProgress).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试续学位置' })); await waitFor(() => expect(video.currentTime).toBe(247));
  expect(m.resource).toHaveBeenCalledTimes(1); expect(m.understanding).toHaveBeenCalledTimes(1);
});

it('shows an actual processing failure without a fabricated 100% progress bar', async (): Promise<void> => {
  m.understandingStatus.mockResolvedValueOnce({ phase: 'failed', failureReason: '服务不可用' }); await open();
  fireEvent.click(screen.getByText('查看处理详情', { selector: 'summary' })); expect(screen.getByText('AI 整理失败')).toBeTruthy();
  expect(document.querySelector('[style*="width: 100%"]')).toBeNull(); expect(screen.queryByText('100%')).toBeNull();
});

it('prevents overlapping status polls and refreshes products after manual terminal recovery', async (): Promise<void> => {
  let fail!: (reason: Error) => void;
  m.understandingStatus.mockResolvedValueOnce({ phase: 'deep-extract' }).mockImplementationOnce(() => new Promise<never>((_, reject) => { fail = reject; })).mockResolvedValueOnce({ phase: 'completed' });
  vi.useFakeTimers(); await act(async (): Promise<void> => { render(<StudyPage />); });
  const video = document.querySelector('video'); await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(6000); });
  expect(m.understandingStatus).toHaveBeenCalledTimes(2);
  await act(async (): Promise<void> => { fail(new Error('暂时断开')); }); expect(screen.getByRole('button', { name: '重试处理状态' })).toBeTruthy();
  m.generatedNote.mockResolvedValueOnce({ note: { markdown: '恢复后的AI笔记', sourceCount: 1 } });
  await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: '重试处理状态' })); });
  expect(screen.getByText('恢复后的AI笔记')).toBeTruthy(); expect(m.understanding).toHaveBeenCalledTimes(2); expect(document.querySelector('video')).toBe(video);
});

it('shows a recoverable PDF page error instead of a broken image', async (): Promise<void> => {
  m.content.mockResolvedValue({ contentId: 'c', contentType: 'document', title: '中文课件', pageCount: 222, status: '已就绪' });
  m.resource.mockResolvedValue({ contentType: 'document', format: 'PDF', url: '/api/storage/object?sig=test', pageCount: 222 });
  m.progress.mockResolvedValue({ contentType: 'document', page: 7, scrollRatio: 0 });
  render(<StudyPage />);
  const page = await screen.findByRole('img', { name: '中文课件 第 7 页' });
  expect(new URL(page.getAttribute('src') ?? '', window.location.href).href).toBe(new URL('/api/storage/object?sig=test&page=7', window.location.href).href);
  expect(page.getAttribute('srcset')).toBeNull();
  fireEvent.error(page);
  expect((await screen.findByRole('alert')).textContent).toContain('PDF 页面加载失败');
  expect(screen.getByRole('link', { name: '打开原文件' }).getAttribute('href')).toBe('/api/storage/object?sig=test');
  fireEvent.click(screen.getByRole('button', { name: '重试本页' }));
  expect(await screen.findByRole('img', { name: '中文课件 第 7 页' })).not.toBeNull();
});

it('does not start stale loads when StrictMode initial content returns after the current load', async (): Promise<void> => {
  let finishOld!: (value: object) => void;
  m.content.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
  m.resource.mockResolvedValueOnce({ contentType:'video',format:'MP4',url:'/current-video' }).mockRejectedValueOnce(new Error('旧请求失败'));
  render(<StrictMode><StudyPage /></StrictMode>);
  await screen.findByText('完整AI笔记');
  expect(document.querySelector('video')?.getAttribute('src')).toBe('/current-video');
  await act(async (): Promise<void> => { finishOld({contentId:'c',contentType:'video',title:'过期标题',durationSec:1800,status:'已就绪'}); });
  expect(screen.queryByText(/原资料加载失败/)).toBeNull();
  expect(screen.getByRole('heading',{level:1,name:'测试课程'})).toBeTruthy();
  expect(m.resource).toHaveBeenCalledTimes(1);
});

it('ignores a late failed resource after a newer retry succeeds', async (): Promise<void> => {
  let failOld!: (reason: Error) => void;
  m.resource.mockReturnValueOnce(new Promise((_resolve,reject) => { failOld=reject; }));
  m.notes.mockRejectedValueOnce(new Error('初次笔记失败'));
  render(<StudyPage searchParams={{t:'240'}} />);
  fireEvent.click(await screen.findByRole('button',{name:'重新加载资料'}));
  await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('/video'));
  await act(async (): Promise<void> => { failOld(new Error('过期资源失败')); });
  expect(screen.queryByText(/原资料加载失败/)).toBeNull();
  expect(screen.queryByRole('button',{name:'重新加载资料'})).toBeNull();
  const video=document.querySelector('video')!; fireEvent.loadedMetadata(video); expect(video.currentTime).toBe(240);
});

it('ignores a late successful resource after a newer retry succeeds', async (): Promise<void> => {
  let finishOld!: (value: object) => void;
  m.resource.mockReturnValueOnce(new Promise((resolve) => { finishOld=resolve; }));
  m.notes.mockRejectedValueOnce(new Error('初次笔记失败'));
  render(<StudyPage />); fireEvent.click(await screen.findByRole('button',{name:'重新加载资料'}));
  await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('/video'));
  await act(async (): Promise<void> => { finishOld({contentType:'video',format:'MP4',url:'/stale-video'}); });
  expect(document.querySelector('video')?.getAttribute('src')).toBe('/video');
});
