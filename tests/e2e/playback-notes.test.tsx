import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaybackNotes } from '@/components/study/PlaybackNotes';
import type { Understanding } from '@/services/api';

const understanding: Understanding = {
  contentId: 'video', status: 'completed', textBlocks: [],
  knowledgePoints: [
    { pointId: 'a', title: '梯度方向', summary: '沿负梯度方向更新', tags: [], importance: 5, refs: [{ type: 'video', timestampSec: 10 }] },
    { pointId: 'b', title: '学习率', summary: '过大可能越过最小值', tags: [], importance: 4, refs: [{ type: 'video', timestampSec: 30 }] },
  ],
  transcriptSegments: [{ segmentId: 's', seq: 0, startMs: 10000, endMs: 12000, text: '这里看负梯度方向' }],
};

describe('playback notes interaction', () => {
  afterEach(cleanup);
  it('follows play/pause/seek positions, switches to all and jumps to an exact source', () => {
    const onJump = vi.fn(); const onSave = vi.fn(async (): Promise<void> => undefined);
    const props = { positionSec: 0, durationSec: 60, understanding, onJump, onSave };
    const view = render(createElement(PlaybackNotes, props));
    expect(screen.queryByText('梯度方向')).toBeNull();
    view.rerender(createElement(PlaybackNotes, { ...props, positionSec: 10.5 }));
    expect(screen.getByText('梯度方向')).toBeTruthy(); expect(screen.getByText('这里看负梯度方向')).toBeTruthy();
    view.rerender(createElement(PlaybackNotes, { ...props, positionSec: 30 }));
    expect(screen.getByText('学习率')).toBeTruthy(); expect(screen.queryByText('梯度方向')).toBeNull();
    expect(screen.queryByText('这里看负梯度方向')).toBeNull();
    view.rerender(createElement(PlaybackNotes, { ...props, positionSec: 30 }));
    expect(screen.getByText('学习率')).toBeTruthy();
    view.rerender(createElement(PlaybackNotes, { ...props, positionSec: 11 }));
    expect(screen.getByText('梯度方向')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '全部重点 · 2' }));
    expect(screen.getByText('学习率')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '回看 0:30' }));
    expect(onJump).toHaveBeenCalledWith(30); expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps first input timestamp and draft after failure and clears only after successful retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValue(undefined);
    const props = { positionSec: 10.5, durationSec: 60, understanding, onJump: vi.fn(), onSave };
    const view = render(createElement(PlaybackNotes, props));
    fireEvent.change(screen.getByLabelText('补充我的笔记'), { target: { value: '我的理解' } });
    view.rerender(createElement(PlaybackNotes, { ...props, positionSec: 35 }));
    fireEvent.click(screen.getByRole('button', { name: '保存补充' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onSave).toHaveBeenLastCalledWith('我的理解', 10);
    expect((screen.getByLabelText('补充我的笔记') as HTMLTextAreaElement).value).toBe('我的理解');
    fireEvent.click(screen.getByRole('button', { name: '保存补充' }));
    expect(await screen.findByText('已保存到我的笔记')).toBeTruthy();
    expect(onSave).toHaveBeenLastCalledWith('我的理解', 10);
    expect((screen.getByLabelText('补充我的笔记') as HTMLTextAreaElement).value).toBe('');
  });

  it('reports missing anchors and only shows transcript within its actual interval', () => {
    render(createElement(PlaybackNotes, { positionSec: 12, durationSec: 60, understanding: { ...understanding, knowledgePoints: [] }, onJump: vi.fn(), onSave: vi.fn() }));
    expect(screen.getByText(/暂无带视频时间引用/)).toBeTruthy();
    expect(screen.queryByText('这里看负梯度方向')).toBeNull();
    expect(screen.getByText('此时间没有可用转写片段。')).toBeTruthy();
  });
});
