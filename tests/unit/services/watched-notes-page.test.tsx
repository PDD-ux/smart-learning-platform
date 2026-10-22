import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { WatchedNotes } from '@/components/study/WatchedNotes';
import type { Understanding } from '@/services/api';
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/services/watched-notes', () => ({ generateWatchedNote: mocks.generate }));
const segment = { segmentId: 'seg1', seq: 0, startMs: 0, endMs: 10000, text: '课堂真实来源' };
const understanding: Understanding = { contentId: 'video1', status: 'completed', knowledgePoints: [], textBlocks: [], transcriptSegments: [segment] };
const note = { markdown: '本段实际笔记', sources: [segment], generatedAt: new Date().toISOString() };
const props = { contentId: 'video1', positionSec: 0, playing: false, seekVersion: 0, understanding, onJump: vi.fn(), onSave: vi.fn() };
describe('video watched notes', (): void => {
  beforeEach((): void => { vi.clearAllMocks(); mocks.generate.mockResolvedValue(note); props.onSave.mockResolvedValue(undefined); });
  afterEach((): void => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('generates while continuous playback advances, not when initially paused', async (): Promise<void> => {
    const { rerender } = render(<WatchedNotes {...props} />); expect(mocks.generate).not.toHaveBeenCalled();
    rerender(<WatchedNotes {...props} playing />);
    for (let position = 1; position <= 30; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} />);
    await screen.findByText('本段实际笔记'); expect(mocks.generate).toHaveBeenCalledWith('video1', ['seg1'], 10);
    rerender(<WatchedNotes {...props} playing={false} positionSec={30} />); expect(mocks.generate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '保存到我的笔记' }));
    await screen.findByRole('button', { name: '已保存到我的笔记' }); expect(props.onSave).toHaveBeenCalledWith(expect.stringContaining('本段实际笔记'), 0);
  });
  it('does not treat a seek as watching skipped sources', (): void => {
    const { rerender } = render(<WatchedNotes {...props} playing />);
    rerender(<WatchedNotes {...props} playing positionSec={100} seekVersion={1} />);
    rerender(<WatchedNotes {...props} positionSec={100} seekVersion={1} />); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('formats headings but persists the original Markdown and real time', async (): Promise<void> => {
    const markdown = '### 课程要点\n\n真实依据摘要。\n\n来源：0:00';
    mocks.generate.mockResolvedValue({ ...note, markdown });
    const { rerender } = render(<WatchedNotes {...props} playing />);
    for (let position = 1; position <= 12; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} />);
    rerender(<WatchedNotes {...props} positionSec={12} />);
    await screen.findByRole('heading', { name: '课程要点', level: 3 });
    expect(screen.getByText('第 1 批 · 0:00—0:10')).toBeTruthy();
    expect(screen.getByText('未保存')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存到我的笔记' }));
    await screen.findByRole('button', { name: '已保存到我的笔记' });
    expect(props.onSave).toHaveBeenCalledWith('随看AI笔记（辅助，待核对）\n\n' + markdown, 0);
    expect(screen.getByText('已保存')).toBeTruthy();
  });
  it('exports original Markdown and source text rather than rendered HTML', async (): Promise<void> => {
    let downloaded: Blob | null = null;
    const BrowserUrl = URL;
    vi.stubGlobal('URL', class extends BrowserUrl {
      static createObjectURL(blob: Blob): string { downloaded = blob; return 'blob:test-note'; }
      static revokeObjectURL(): void { /* test file released */ }
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation((): void => undefined);
    const markdown = '### 课程要点\n\n真实依据摘要。\n\n来源：0:00';
    mocks.generate.mockResolvedValue({ ...note, markdown });
    const { rerender } = render(<WatchedNotes {...props} playing />);
    for (let position = 1; position <= 12; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} />);
    rerender(<WatchedNotes {...props} positionSec={12} />);
    await screen.findByRole('heading', { name: '课程要点', level: 3 });
    fireEvent.click(screen.getByRole('button', { name: '导出本次笔记' }));
    expect(downloaded).not.toBeNull();
    const blob = downloaded as Blob | null;
    const content = await blob?.text();
    expect(content).toContain(markdown); expect(content).toContain(segment.text); expect(content).not.toContain('<h3');
  });
  it('labels new extracts without treating older summaries as checked', async (): Promise<void> => {
    mocks.generate.mockResolvedValue({ ...note, mode: 'source-extract' });
    const { rerender } = render(<WatchedNotes {...props} playing />);
    for (let position = 1; position <= 12; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} />);
    rerender(<WatchedNotes {...props} positionSec={12} />);
    await screen.findByText('AI精选原文 · ASR转写待核对');
    fireEvent.click(screen.getByRole('button', { name: '保存到我的笔记' }));
    await screen.findByRole('button', { name: '已保存到我的笔记' });
    expect(props.onSave).toHaveBeenCalledWith('随看AI笔记（原文摘录，转写待核对）\n\n' + note.markdown, 0);
  });
  it('finishes watched tail after the earlier model request completes while paused', async (): Promise<void> => {
    let resolveFirst!: (value: typeof note) => void;
    mocks.generate.mockReturnValueOnce(new Promise<typeof note>((resolve): void => { resolveFirst = resolve; }));
    const second = { ...segment, segmentId: 'seg2', startMs: 32000, endMs: 35000 };
    mocks.generate.mockResolvedValueOnce({ ...note, markdown: '尾段笔记', sources: [second] });
    const data = { ...understanding, transcriptSegments: [segment, second] };
    const { rerender } = render(<WatchedNotes {...props} playing understanding={data} />);
    for (let position = 1; position <= 40; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} understanding={data} />);
    rerender(<WatchedNotes {...props} positionSec={40} understanding={data} />); expect(mocks.generate).toHaveBeenCalledTimes(1);
    await act(async (): Promise<void> => { resolveFirst(note); });
    await screen.findByText('尾段笔记'); expect(mocks.generate).toHaveBeenNthCalledWith(2, 'video1', ['seg2'], 35);
  });
  it('flushes complete viewed speech on pause and retains failed request for explicit retry', async (): Promise<void> => {
    mocks.generate.mockRejectedValueOnce(new Error('模型暂不可用'));
    const { rerender } = render(<WatchedNotes {...props} playing />);
    for (let position = 1; position <= 12; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} />);
    rerender(<WatchedNotes {...props} positionSec={12} />);
    await screen.findByRole('alert'); expect(mocks.generate).toHaveBeenCalledTimes(1);
    rerender(<WatchedNotes {...props} positionSec={13} />); expect(mocks.generate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '手动重试' }));
    await screen.findByText('本段实际笔记'); expect(mocks.generate).toHaveBeenNthCalledWith(2, 'video1', ['seg1'], 10);
  });
  it('preserves note after failed save without auto retry', async (): Promise<void> => {
    props.onSave.mockRejectedValue(new Error('保存故障'));
    const { rerender } = render(<WatchedNotes {...props} playing />);
    for (let position = 1; position <= 12; position += 1) rerender(<WatchedNotes {...props} playing positionSec={position} />);
    rerender(<WatchedNotes {...props} positionSec={12} />); await screen.findByText('本段实际笔记');
    fireEvent.click(screen.getByRole('button', { name: '保存到我的笔记' })); await waitFor((): void => { expect(screen.getByRole('alert').textContent).toContain('保存故障'); });
    expect(screen.getByText('本段实际笔记')).toBeTruthy(); expect(props.onSave).toHaveBeenCalledTimes(1);
  });
});
