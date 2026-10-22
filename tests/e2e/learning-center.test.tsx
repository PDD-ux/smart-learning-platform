import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContentSummary } from '@/services/api';

const m = vi.hoisted(() => ({ courses: vi.fn(), contents: vi.fn(), progress: vi.fn(), createUploadIntent: vi.fn(), completeUpload: vi.fn(), content: vi.fn(), upload: vi.fn(), updateContent: vi.fn(), deleteContent: vi.fn() }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactElement => createElement('main', null, children) }));
vi.mock('@/services/api', () => ({ api: m, uploadToPresignedUrl: m.upload }));
import ImportPage from '@/app/import/page';
import { ContentStudyMeta } from '@/components/app/ContentStudyMeta';

const video: ContentSummary = { contentId: 'v', contentType: 'video', title: '30分钟课堂', description: null, coverUrl: null, status: '已就绪', understandingStatus: 'completed', durationSec: 1800.032, pageCount: null, createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z' };
const history = { contentType: 'video', positionSec: 247, lastStudiedAt: '2026-10-10T00:00:00Z' };
beforeEach((): void => {
  vi.resetAllMocks(); m.contents.mockResolvedValue({ items: [video] }); m.progress.mockResolvedValue(history);
  m.courses.mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });
  m.createUploadIntent.mockResolvedValue({ contentId: 'v', uploadUrl: '/test-upload' }); m.upload.mockResolvedValue(undefined); m.completeUpload.mockResolvedValue(video); m.content.mockResolvedValue(video);
});
afterEach((): void => { cleanup(); vi.useRealTimers(); });

it('keeps selected import files and private form mounted while switching shared space', async (): Promise<void> => {
  const view = render(<ImportPage />); await screen.findByText(video.title);

  const fileInput = view.container.querySelector('input[type="file"]'); expect(fileInput).toBeTruthy();
  fireEvent.change(fileInput!, { target: { files: [new File(['fixture'], 'own-lecture.mp4', { type: 'video/mp4' })] } });
  expect(screen.getAllByText(/own-lecture.mp4/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '共享课程' }));
  await screen.findByText('已发布 · 0 门');
  expect(view.container.querySelector('input[type="file"]')).toBe(fileInput);
  fireEvent.click(screen.getByRole('button', { name: '我的资料' }));
  expect(screen.getAllByText(/own-lecture.mp4/).length).toBeGreaterThan(0); expect(m.createUploadIntent).not.toHaveBeenCalled();
});

it('shows import as waiting before a file is uploaded, without marking step one active', async (): Promise<void> => {
  render(<ImportPage />); await screen.findByText(video.title);
 const waiting = screen.getByText('待开始');
  expect(screen.queryByText('1 / 5')).toBeNull(); expect(waiting.closest('section')!.querySelector('ol li')!.className).not.toContain('bg-brand-soft');
  fireEvent.change(screen.getByLabelText(/选择课堂视频文件/), { target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] } });
  expect(screen.getByText('待开始')).toBeTruthy(); expect(m.createUploadIntent).not.toHaveBeenCalled();
  m.upload.mockReturnValue(new Promise<never>(() => undefined)); fireEvent.click(screen.getByRole('button', { name: '开始导入课堂视频' })); await screen.findByText('1 / 5');
});

it('shows the library and importer together and preserves a selected file when import is collapsed', async (): Promise<void> => {
  const { container } = render(<ImportPage />);
  await screen.findByText('上次看到 4:07');
  expect(screen.getByText('时长：30:00')).toBeTruthy();
  expect(screen.getByText('AI：笔记已就绪')).toBeTruthy();
  expect(screen.getByRole('button', { name: '开始导入课堂视频' })).toBeTruthy();
  expect(container.querySelector('#learning-library')!.compareDocumentPosition(container.querySelector('#content-import-panel')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const fileInput = screen.getByLabelText(/选择课堂视频文件/) as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] } });
  fireEvent.click(screen.getByRole('button', { name: '收起导入' }));
  expect(screen.queryByRole('button', { name: '开始导入课堂视频' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导入新资料' }));
  expect(screen.getByText(/已选择：lesson.mp4 ·/)).toBeTruthy();
  expect(fileInput.files?.[0].name).toBe('lesson.mp4');
  expect(m.createUploadIntent).not.toHaveBeenCalled();
});

it('separates an empty library from a search with no matches', async (): Promise<void> => {
  render(<ImportPage />); await screen.findByText(video.title);
  fireEvent.change(screen.getByLabelText('搜索资料'), { target: { value: '不存在' } });
  expect(screen.getByText(/暂无符合条件/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '导入第一份资料' })).toBeNull();
  cleanup(); m.contents.mockResolvedValue({ items: [] }); render(<ImportPage />);
  fireEvent.click(await screen.findByRole('button', { name: '导入第一份资料' }));
  expect(screen.getByRole('button', { name: '开始导入课堂视频' })).toBeTruthy();
});

it('distinguishes no study history from a saved zero-second position', async (): Promise<void> => {
  m.progress.mockResolvedValueOnce({ ...history, positionSec: 0, lastStudiedAt: null });
  const view = render(<ContentStudyMeta item={video} />);
  await screen.findByText('尚未开始学习');
  m.progress.mockResolvedValueOnce({ ...history, positionSec: 0 });
  view.rerender(<ContentStudyMeta item={{ ...video, contentId: 'other' }} />);
  await screen.findByText('上次看到 0:00');
});

it('keeps a rename draft and independently retries invalid study progress', async (): Promise<void> => {
  m.progress.mockResolvedValueOnce({ ...history, positionSec: 1801 });
  render(<ImportPage />); await screen.findByText('续学位置读取失败');
  fireEvent.click(screen.getByRole('button', { name: '改名' }));
  fireEvent.change(screen.getByLabelText('资料标题'), { target: { value: '未保存的标题' } });
  fireEvent.click(screen.getByRole('button', { name: '重试学习位置' }));
  await screen.findByText('上次看到 4:07');
  expect((screen.getByLabelText('资料标题') as HTMLInputElement).value).toBe('未保存的标题');
  expect(m.contents).toHaveBeenCalledTimes(1);
});

it('displays document pages and lets AI-failed ready content remain learnable', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [{ ...video, contentType: 'document', pageCount: 4, durationSec: null, understandingStatus: 'failed' }] });
  m.progress.mockResolvedValue({ contentType: 'document', page: 3, scrollRatio: 0, lastStudiedAt: history.lastStudiedAt });
  render(<ImportPage />);
  await screen.findByText('上次读到第 3 页');
  expect(screen.getByText('页数：4 页')).toBeTruthy();
  expect(screen.getByText('AI：整理失败，原资料仍可学习')).toBeTruthy();
  expect(screen.getByRole('link', { name: '进入学习' }).getAttribute('href')).toBe('/study/v');
});

it('does not request a resume position or show a study link for unready material', async (): Promise<void> => {
  m.contents.mockResolvedValue({ items: [{ ...video, status: '解析中', understandingStatus: 'none' }] });
  render(<ImportPage />); await screen.findByText('资料尚未就绪');
  expect(m.progress).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: '进入学习' })).toBeNull();
  expect(screen.getByText('AI：尚未整理')).toBeTruthy();
});

it.each([
  { ...history, positionSec: -1 },
  { ...history, positionSec: Number.NaN },
  { ...history, lastStudiedAt: 'invalid-date' },
  { contentType: 'document', page: 1, scrollRatio: 0, lastStudiedAt: history.lastStudiedAt },
])('refuses invalid or mismatched position metadata %#', async (value): Promise<void> => {
  m.progress.mockResolvedValue(value);
  render(<ContentStudyMeta item={video} />);
  await screen.findByText('续学位置读取失败');
  expect(screen.queryByText('尚未开始学习')).toBeNull();
  expect(screen.queryByText(/上次看到/)).toBeNull();
});

it('reports missing duration as unknown while retaining valid history', async (): Promise<void> => {
  render(<ContentStudyMeta item={{ ...video, durationSec: 0 }} />);
  await screen.findByText('上次看到 4:07');
  expect(screen.getByText('时长：未知')).toBeTruthy();
});

it('ignores a late position response after switching the material', async (): Promise<void> => {
  let resolveOld!: (value: typeof history) => void;
  m.progress.mockImplementationOnce(() => new Promise<typeof history>((resolve): void => { resolveOld = resolve; }));
  const view = render(<ContentStudyMeta item={video} />);
  m.progress.mockResolvedValueOnce({ ...history, positionSec: 12 });
  view.rerender(<ContentStudyMeta item={{ ...video, contentId: 'new' }} />);
  await screen.findByText('上次看到 0:12');
  await act(async (): Promise<void> => { resolveOld(history); });
  expect(screen.getByText('上次看到 0:12')).toBeTruthy();
});

it('continues polling AI work when the import panel is collapsed', async (): Promise<void> => {
  render(<ImportPage />); await screen.findByText(video.title);
  vi.useFakeTimers();
  m.content.mockResolvedValueOnce({ ...video, understandingStatus: 'running' }).mockResolvedValueOnce(video);

  fireEvent.change(screen.getByLabelText(/选择课堂视频文件/), { target: { files: [new File(['video'], 'lesson.mp4', { type: 'video/mp4' })] } });
  await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: '开始导入课堂视频' })); });
  expect((screen.getByRole('button', { name: '收起导入' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(2000); });
  fireEvent.click(screen.getByRole('button', { name: '收起导入' }));
  expect(screen.getByRole('button', { name: '查看处理进度' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('AI 正在后台整理笔记');
  await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole('status').textContent).toContain('AI 整理笔记已完成');
  expect(within(screen.getByRole('article')).getByText('AI：笔记已就绪')).toBeTruthy();
  expect(m.content).toHaveBeenCalledTimes(2);
});

it('reuses a failed upload intent for the same file instead of creating another record', async (): Promise<void> => {
  m.upload.mockRejectedValueOnce(new Error('传输失败'));
  m.content.mockResolvedValueOnce({...video,status:'待导入'});
  render(<ImportPage />); await screen.findByText(video.title);

  const file=new File(['video'],'lesson.mp4',{type:'video/mp4'});
  fireEvent.change(screen.getByLabelText(/选择课堂视频文件/),{target:{files:[file]}});
  fireEvent.click(screen.getByRole('button',{name:'开始导入课堂视频'})); await screen.findByText('传输失败');
  fireEvent.click(screen.getByRole('button',{name:'开始导入课堂视频'}));
  await waitFor(() => expect(m.completeUpload).toHaveBeenCalledTimes(1));
  expect(m.createUploadIntent.mock.calls[1][0].contentId).toBe('v'); expect(m.upload).toHaveBeenCalledTimes(2);
});
it('recovers processing after uncertain complete without repeating upload or intent creation', async (): Promise<void> => {
  m.completeUpload.mockRejectedValueOnce(new Error('确认响应断开'));
  render(<ImportPage />); await screen.findByText(video.title);

  fireEvent.change(screen.getByLabelText(/选择课堂视频文件/),{target:{files:[new File(['v'],'lesson.mp4',{type:'video/mp4'})]}});
  fireEvent.click(screen.getByRole('button',{name:'开始导入课堂视频'})); await screen.findByText('确认响应断开');
  fireEvent.click(screen.getByRole('button',{name:'开始导入课堂视频'})); await screen.findByText('原资料已进入处理，正在恢复进度…');
  expect(m.createUploadIntent).toHaveBeenCalledTimes(1); expect(m.upload).toHaveBeenCalledTimes(1); expect(m.completeUpload).toHaveBeenCalledTimes(1);
});
