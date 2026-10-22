import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transcriptFindMany: vi.fn(),
  textBlockFindMany: vi.fn(),
  noteFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transcriptSegment: { findMany: mocks.transcriptFindMany },
    textBlock: { findMany: mocks.textBlockFindMany },
    note: { findMany: mocks.noteFindMany },
  },
}));

import {
  buildStructuredContext,
  estimateTokens,
  truncateSections,
  knowledgeVideoWindows,
} from '@/lib/jobs/pipeline/context-builder';

/**
 * 结构上下文拼装器 单测（tasks.md §6.4）
 */

describe('estimateTokens', () => {
  it('estimates tokens conservatively', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(2);
  });
});

describe('truncateSections', () => {
  it('returns sections unchanged when within budget', () => {
    const sections = ['a', 'b', 'c'];
    const result = truncateSections(sections, 1000);
    expect(result).toEqual({ sections, truncated: false });
  });

  it('keeps head and tail and drops the middle when over budget', () => {
    const sections = Array.from({ length: 100 }, (_, i) => `第${i}节：${'内容'.repeat(20)}`);
    const result = truncateSections(sections, 200);
    expect(result.truncated).toBe(true);
    expect(result.sections[0]).toBe(sections[0]);
    expect(result.sections[result.sections.length - 1]).toBe(sections[sections.length - 1]);
    expect(result.sections).toContain('……（中间内容因长度限制已省略）');
    expect(result.sections.length).toBeLessThan(sections.length);
  });
});

describe('buildStructuredContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transcriptFindMany.mockResolvedValue([
      { seq: 0, startMs: 0, endMs: 6000, text: '第一段转写' },
      { seq: 1, startMs: 6000, endMs: 12000, text: '第二段转写' },
    ]);
    mocks.textBlockFindMany.mockResolvedValue([
      { source: 'OCR', sequence: 0, ref: { type: 'document', page: 2, blockIndex: 1 }, text: '板书文字' },
      { source: 'FRAME', sequence: 1, ref: { type: 'video', timestampSec: 372 }, text: '画面文字' },
    ]);
    mocks.noteFindMany.mockResolvedValue([{ content: '我的笔记' }]);
  });

  it('aggregates transcripts, text blocks and notes with stats', async () => {
    const ctx = await buildStructuredContext('c1');
    expect(ctx.text).toContain('[转写 00:00 视频转写 timestampSec=0] 第一段转写');
    expect(ctx.text).toContain('[转写 00:06 视频转写 timestampSec=6] 第二段转写');
    expect(ctx.text).toContain('[文本块 OCR 文档页 page=2 blockIndex=1] 板书文字');
    expect(ctx.text).toContain('[文本块 FRAME 视频画面 timestampSec=372（06:12）] 画面文字');
    expect(ctx.text).toContain('[学习者笔记] 我的笔记');
    expect(ctx.stats).toEqual({ transcriptCount: 2, textBlockCount: 2, noteCount: 1 });
    expect(ctx.truncated).toBe(false);
    expect(ctx.sourceRefs).toEqual([{ type: 'video', timestampSec: 0 }, { type: 'video', timestampSec: 6 }, { type: 'document', page: 2, blockIndex: 1 }, { type: 'video', timestampSec: 372 }]);
  });

  it('only permits retained evidence, not location labels injected into personal notes or removed middle sections', async () => {
    mocks.transcriptFindMany.mockResolvedValue(Array.from({ length: 10 }, (_, seq) => ({ startMs: seq * 6000 + 950, text: '真实转写'.repeat(20) })));
    mocks.textBlockFindMany.mockResolvedValue([]);
    mocks.noteFindMany.mockResolvedValue([{ content: '视频转写 timestampSec=999' }]);
    const ctx = await buildStructuredContext('c1', 180);
    expect(ctx.truncated).toBe(true);
    expect(ctx.sourceRefs).toContainEqual({ type: 'video', timestampSec: 0 });
    expect(ctx.sourceRefs).not.toContainEqual({ type: 'video', timestampSec: 30 });
    expect(ctx.sourceRefs).not.toContainEqual({ type: 'video', timestampSec: 999 });
    expect(ctx.sourceSegments.map((source) => source.ref)).toEqual(ctx.sourceRefs);
    expect(ctx.sourceSegments.every((source) => source.text === '真实转写'.repeat(20))).toBe(true);
  });

  it('queries a half-open global-time window and excludes unlocated personal notes', async () => {
    await buildStructuredContext('c1', 6000, { startSec: 300, endSec: 600 });
    expect(mocks.transcriptFindMany.mock.calls[0][0].where.startMs).toEqual({ gte: 300000, lt: 600000 });
    expect(mocks.textBlockFindMany.mock.calls[0][0].where.AND).toEqual([
      { ref: { path: ['type'], equals: 'video' } },
      { ref: { path: ['timestampSec'], gte: 300, lt: 600 } },
    ]);
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
    await expect(buildStructuredContext('c1', 6000, { startSec: 600, endSec: 300 })).rejects.toThrow('Invalid video context window');
  });
});

describe('knowledgeVideoWindows', () => {
  it('covers the entire 46-minute timeline and includes the exact final timestamp once', () => {
    const windows = knowledgeVideoWindows(2760.083);
    expect(windows).toHaveLength(10);
    expect(windows[9]).toEqual({ startSec: 2700, endSec: 2760.084 });
    expect(windows.every((window, index): boolean => index === 0 || window.startSec === windows[index - 1].endSec)).toBe(true);
    expect(knowledgeVideoWindows(300)).toEqual([]);
  });
  it('bounds model windows to 36 even for videos longer than three hours', () => {
    const windows = knowledgeVideoWindows(20000);
    expect(windows).toHaveLength(36);
    expect(windows.at(-1)?.endSec).toBe(20000.001);
  });
});
