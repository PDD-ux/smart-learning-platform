import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UrlDraftView } from '@/lib/url-imports/contracts';
const client = vi.hoisted(() => ({ import: vi.fn(), read: vi.fn(), cancel: vi.fn() }));
vi.mock('@/services/video-imports', () => ({ videoImports: client }));
import { VideoUrlImportPanel } from '@/components/import/VideoUrlImportPanel';
const done: UrlDraftView = { requestId: '31d8819c-e754-43d2-b399-7d6193f81810', state: 'COMMITTED', contentId: 'video-one', preview: null, existing: [], error: null, expiresAt: '' };
beforeEach((): void => { vi.clearAllMocks(); sessionStorage.clear(); client.import.mockResolvedValue(done); client.read.mockResolvedValue(done); });
afterEach((): void => { cleanup(); sessionStorage.clear(); });
it('requires rights and quota consent before posting a video link, then opens the learning route', async (): Promise<void> => {
  const saved = vi.fn(); render(<VideoUrlImportPanel onSaved={saved}/>); fireEvent.change(screen.getByLabelText('视频文件直链'), { target: { value: 'https://example.org/lesson.mp4' } });
  const button = screen.getByRole('button', { name: '导入视频并开始解析' }) as HTMLButtonElement; expect(button.disabled).toBe(true); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
  expect((await screen.findByRole('link', { name: '进入学习' })).getAttribute('href')).toBe('/study/video-one'); expect(client.import).toHaveBeenCalledOnce(); expect(saved).toHaveBeenCalledOnce(); expect(sessionStorage.getItem('learning-video-url-id')).not.toContain('https');
});
it('restores using GET and never repeats a download', async (): Promise<void> => { sessionStorage.setItem('learning-video-url-id', done.requestId); render(<VideoUrlImportPanel onSaved={vi.fn()}/>); await screen.findByRole('link', { name: '进入学习' }); expect(client.import).not.toHaveBeenCalled(); });
it('can clear an unavailable local ID after switching accounts without importing again', async (): Promise<void> => { sessionStorage.setItem('learning-video-url-id', done.requestId); client.read.mockRejectedValue(Error('not owned')); render(<VideoUrlImportPanel onSaved={vi.fn()}/>); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '清除本机编号，开始新的导入' })); expect(sessionStorage.getItem('learning-video-url-id')).toBeNull(); expect((screen.getByLabelText('视频文件直链') as HTMLInputElement).disabled).toBe(false); expect(client.import).not.toHaveBeenCalled(); });
it('keeps the request ID after uncertain network failure and recovers by reading status', async (): Promise<void> => {
  client.import.mockRejectedValue(Error('offline')); render(<VideoUrlImportPanel onSaved={vi.fn()}/>); fireEvent.change(screen.getByLabelText('视频文件直链'), { target: { value: 'https://example.org/lesson.mp4' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '导入视频并开始解析' }));
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '重新读取状态' })); await screen.findByRole('link', { name: '进入学习' }); expect(client.import).toHaveBeenCalledOnce();
});
it('cancels an active download and ignores its late committed response', async (): Promise<void> => {
  let finish: (value: UrlDraftView) => void = (): void => undefined; client.import.mockReturnValue(new Promise<UrlDraftView>((resolve): void => { finish = resolve; })); client.cancel.mockResolvedValue({ ...done, state: 'CANCELLED', contentId: null });
  const saved = vi.fn(); render(<VideoUrlImportPanel onSaved={saved}/>); fireEvent.change(screen.getByLabelText('视频文件直链'), { target: { value: 'https://example.org/lesson.mp4' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '导入视频并开始解析' })); fireEvent.click(screen.getByRole('button', { name: '取消导入' }));
  await screen.findByText('视频导入已取消'); finish(done); await waitFor((): void => expect(screen.queryByRole('link', { name: '进入学习' })).toBeNull()); expect(saved).not.toHaveBeenCalled();
});
