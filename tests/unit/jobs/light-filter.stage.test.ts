import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  txDeleteBlocks: vi.fn(),
  txCreateBlocks: vi.fn(),
  txDeleteTranscript: vi.fn(),
  txCreateTranscript: vi.fn(),
  transcriptFindFirst: vi.fn(),
  getObject: vi.fn(),
  localFilePath: vi.fn(),
  materialize: vi.fn(),
  isFfmpegAvailable: vi.fn(),
  extractFrameChunks: vi.fn(),
  extractAudioChunks: vi.fn(),
  classify: vi.fn(),
  detectText: vi.fn(),
  selectFrames: vi.fn(),
  transcribe: vi.fn(),
  readFile: vi.fn(),
  parseDocument: vi.fn(),
  isPdfRendererAvailable: vi.fn(),
  renderPdfPages: vi.fn(),
}));

vi.mock('@/lib/media/frame-bytes', () => ({ readFileBase64: mocks.readFile }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.contentFindUnique },
    transcriptSegment: { findFirst: mocks.transcriptFindFirst },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        textBlock: { deleteMany: mocks.txDeleteBlocks, createMany: mocks.txCreateBlocks },
        transcriptSegment: {
          deleteMany: mocks.txDeleteTranscript,
          createMany: mocks.txCreateTranscript,
        },
      }),
  },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    getStorage: () => ({ getObject: mocks.getObject, localFilePath: mocks.localFilePath }),
  };
});

vi.mock('@/lib/media/materialize', () => ({ materializeObject: mocks.materialize }));

vi.mock('@/lib/media/document-parser', () => ({ parseDocument: mocks.parseDocument }));

vi.mock('@/lib/media/pdf-render', () => ({
  isPdfRendererAvailable: mocks.isPdfRendererAvailable,
  renderPdfPages: mocks.renderPdfPages,
}));

vi.mock('@/lib/media/ffmpeg', () => ({
  isFfmpegAvailable: mocks.isFfmpegAvailable,
  extractFrameChunks: mocks.extractFrameChunks,
  extractAudioChunks: mocks.extractAudioChunks,
}));

vi.mock('@/lib/ai/gateway', () => ({
  getInferenceGateway: () => ({
    classify: mocks.classify,
    detectText: mocks.detectText,
    selectFrames: mocks.selectFrames,
  }),
}));

vi.mock('@/lib/ai/asr', () => ({
  transcribe: mocks.transcribe,
  alignSegments: (segments: Array<{ seq: number; startMs: number; endMs: number; text: string }>) =>
    segments
      .filter((segment) => segment.text.trim().length > 0)
      .sort((left, right) => left.startMs - right.startMs)
      .map((segment, index) => ({ ...segment, seq: index })),
}));

import { lightFilterStage, refreshVideoVisualEvidence } from '@/lib/jobs/pipeline/light-filter.stage';
import type { PipelineStageContext } from '@/lib/jobs/pipeline/understanding-pipeline';

/**
 * 阶段 A 端侧筛选 单测（tasks.md §6.3）
 */

const ctx: PipelineStageContext = { contentId: 'c1', traceId: 't1', degraded: { infer: false, asr: false } };

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    contentType: 'DOCUMENT',
    format: 'PNG',
    storageKey: 'contents/c1/a.png',
    durationSec: null,
    ...overrides,
  };
}

function mockFrameChunks(frames: Array<{ frameIndex: number; timestampMs: number; filePath: string }>): void {
  mocks.extractFrameChunks.mockImplementation(async function* () {
    yield { chunkIndex: 0, startSec: 0, durationSec: 60, directory: `/tmp/slp-test-frame-${randomUUID()}`, frames };
  });
}

function mockAudioChunks(): void {
  mocks.extractAudioChunks.mockImplementation(async function* () {
    yield {
      chunkIndex: 0,
      startSec: 0,
      durationSec: 60,
      directory: `/tmp/slp-test-audio-${randomUUID()}`,
      audioPath: '/tmp/audio.wav',
    };
  });
}

describe('lightFilterStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.degraded = { infer: false, asr: false };
    mocks.txDeleteBlocks.mockResolvedValue({ count: 0 });
    mocks.txCreateBlocks.mockResolvedValue({ count: 1 });
    mocks.txDeleteTranscript.mockResolvedValue({ count: 0 });
    mocks.txCreateTranscript.mockResolvedValue({ count: 1 });
    mocks.transcriptFindFirst.mockResolvedValue(null);
    mocks.getObject.mockResolvedValue({ stream: Readable.from(Buffer.from('image-bytes')) });
    mocks.localFilePath.mockReturnValue('/tmp/video.mp4');
    mocks.materialize.mockResolvedValue({ filePath: '/tmp/video.mp4', cleanup: vi.fn(async () => undefined) });
    mocks.isFfmpegAvailable.mockResolvedValue(true);
    mocks.readFile.mockResolvedValue('ZnJhbWUtYnl0ZXM=');
    mocks.classify.mockResolvedValue({ items: [{ frameIndex: 0, category: 'unknown' }] });
    mocks.detectText.mockResolvedValue({
      items: [{ frameIndex: 0, blocks: [{ bbox: [0, 0, 1, 1], text: 'hello', confidence: 0.9 }] }],
    });
    mocks.parseDocument.mockReturnValue({ pageCount: 1, pages: [''], pagesNeedingVisualOcr: [1], requiresVisualOcr: true });
    mocks.isPdfRendererAvailable.mockResolvedValue(true);
    mocks.renderPdfPages.mockResolvedValue([{ page: 1, filePath: '/tmp/page-1.png' }]);
    mockFrameChunks([]);
    mockAudioChunks();
  });

  it('runs classify + detect_text for an image and writes OCR text blocks', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({ format: 'PNG' }));

    await lightFilterStage(ctx);

    expect(mocks.classify).toHaveBeenCalled();
    expect(mocks.detectText).toHaveBeenCalledWith(
      [expect.objectContaining({ frameIndex: 0 })],
      { traceId: ctx.traceId, timeoutMs: 30_000 },
    );
    expect(mocks.txDeleteBlocks).toHaveBeenCalledWith({ where: { contentId: 'c1' } });
    expect(mocks.txCreateBlocks).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ contentId: 'c1', source: 'OCR', sequence: 0, text: 'hello' }),
      ],
    });
  });

  it('renders scanned PDF pages and writes OCR text blocks without replacing PDF text-layer blocks', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({ format: 'PDF', storageKey: 'contents/c1/scan.pdf' }));
    const directory = await mkdtemp(path.join(tmpdir(), 'slp-scanned-pdf-'));
    const pdfPath = path.join(directory, 'scan.pdf');
    await writeFile(pdfPath, '%PDF-1.4\n% scanned fixture', 'latin1');
    mocks.materialize.mockResolvedValueOnce({ filePath: pdfPath, cleanup: vi.fn(async () => undefined) });

    try {
      await lightFilterStage(ctx);

      expect(mocks.renderPdfPages).toHaveBeenCalledWith(pdfPath, [1], expect.any(String));
      expect(mocks.detectText).toHaveBeenCalledWith([expect.objectContaining({ frameIndex: 0 })], expect.anything());
      expect(mocks.txDeleteBlocks).toHaveBeenCalledWith({ where: { contentId: 'c1', source: 'OCR' } });
      expect(mocks.txCreateBlocks).toHaveBeenCalledWith({
        data: [expect.objectContaining({ source: 'OCR', text: 'hello', sequence: 1_010_000 })],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('degrades when ffmpeg is unavailable for video', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/c1/v.mp4' }),
    );
    mocks.isFfmpegAvailable.mockResolvedValue(false);

    await lightFilterStage(ctx);

    expect(ctx.degraded).toMatchObject({ asr: true, asrReason: 'FFmpeg 不可用，无法提取视频音轨' });

    expect(mocks.selectFrames).not.toHaveBeenCalled();
    expect(mocks.txCreateBlocks).not.toHaveBeenCalled();
  });

  it('filters video frames, writes FRAME text blocks and aligned transcript', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/c1/v.mp4', durationSec: 60 }),
    );
    mockFrameChunks([
      { frameIndex: 0, timestampMs: 0, filePath: '/tmp/f0.jpg' },
      { frameIndex: 1, timestampMs: 2_000, filePath: '/tmp/f1.jpg' },
    ]);
    mocks.selectFrames.mockResolvedValue({
      frames: [
        { frameIndex: 0, timestampMs: 0, score: 0.6, keep: true, reason: 'uniform' },
        { frameIndex: 1, timestampMs: 2_000, score: 0.3, keep: false, reason: 'uniform-dropped' },
      ],
    });
    mocks.transcribe.mockResolvedValue({
      available: true,
      provider: 'mock',
      segments: [{ seq: 0, startMs: 0, endMs: 6_000, text: '转写文本' }],
    });

    await lightFilterStage(ctx);

    expect(mocks.detectText).toHaveBeenCalledWith(
      [expect.objectContaining({ frameIndex: 0 })],
      expect.anything(),
    );
    expect(mocks.txCreateBlocks).toHaveBeenCalledWith({
      data: [expect.objectContaining({ source: 'FRAME', text: 'hello' })],
    });
    expect(mocks.txCreateTranscript).toHaveBeenCalledWith({
      data: [expect.objectContaining({ seq: 0, text: '转写文本' })],
    });
  });

  it('skips transcript when ASR is unavailable', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/c1/v.mp4' }),
    );
    mockFrameChunks([{ frameIndex: 0, timestampMs: 0, filePath: '/tmp/f0.jpg' }]);
    mocks.selectFrames.mockResolvedValue({
      frames: [{ frameIndex: 0, timestampMs: 0, score: 0.6, keep: true, reason: 'uniform' }],
    });
    mocks.transcribe.mockResolvedValue({ available: false, provider: 'none', segments: [], reason: '未配置' });

    await lightFilterStage(ctx);

    expect(mocks.txCreateTranscript).not.toHaveBeenCalled();
    expect(mocks.txDeleteTranscript).not.toHaveBeenCalled();
    expect(ctx.degraded.asr).toBe(true);
    expect(ctx.degraded.asrReason).toContain('第 1 段（0 秒起）');
    expect(ctx.degraded.asrReason).toContain('未配置');
  });

  it('retains successful earlier audio chunks and identifies the failed later chunk', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', durationSec: 600 }),
    );
    mocks.extractAudioChunks.mockImplementation(async function* () {
      yield { chunkIndex: 0, startSec: 0, durationSec: 300, directory: `/tmp/slp-test-a0-${randomUUID()}`, audioPath: '/tmp/a0.wav' };
      yield { chunkIndex: 1, startSec: 300, durationSec: 300, directory: `/tmp/slp-test-a1-${randomUUID()}`, audioPath: '/tmp/a1.wav' };
    });
    mocks.transcribe
      .mockResolvedValueOnce({ available: true, provider: 'xunfei', segments: [{ seq: 0, startMs: 1_000, endMs: 2_000, text: '第一段' }] })
      .mockResolvedValueOnce({ available: false, provider: 'xunfei', segments: [], reason: '讯飞 ASR 请求超时' });

    await lightFilterStage(ctx);

    expect(ctx.degraded.asr).toBe(true);
    expect(ctx.degraded.asrReason).toContain('第 2 段（300 秒起）');
    expect(ctx.degraded.asrReason).toContain('请求超时');
    expect(mocks.txDeleteTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.txCreateTranscript).toHaveBeenCalledWith({
      data: [expect.objectContaining({ seq: 0, startMs: 1_000, endMs: 2_000, text: '第一段' })],
    });
  });

  it('retains successful transcription if extracting the next audio chunk fails', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', durationSec: 600 }),
    );
    mocks.extractAudioChunks.mockImplementation(async function* () {
      yield { chunkIndex: 0, startSec: 0, durationSec: 300, directory: `/tmp/slp-test-a0-${randomUUID()}`, audioPath: '/tmp/a0.wav' };
      throw new Error('FFmpeg timeout');
    });
    mocks.transcribe.mockResolvedValueOnce({
      available: true, provider: 'xunfei', segments: [{ seq: 0, startMs: 1_000, endMs: 2_000, text: '第一段' }],
    });

    await lightFilterStage(ctx);

    expect(ctx.degraded.asrReason).toContain('第 2 段音轨提取失败');
    expect(mocks.txCreateTranscript).toHaveBeenCalledWith({
      data: [expect.objectContaining({ seq: 0, startMs: 1_000, endMs: 2_000, text: '第一段' })],
    });
  });

  it('does not accept an ASR success response without usable segments', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({ contentType: 'VIDEO', format: 'MP4', durationSec: 60 }));
    mocks.transcribe.mockResolvedValue({ available: true, provider: 'xunfei', segments: [] });

    await lightFilterStage(ctx);

    expect(ctx.degraded).toMatchObject({ asr: true, asrReason: 'ASR 未返回有效转写文本' });
    expect(mocks.txCreateTranscript).not.toHaveBeenCalled();
  });

  it('does not mark a video complete when no audio chunk was extracted', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({ contentType: 'VIDEO', format: 'MP4', durationSec: 60 }));
    mocks.extractAudioChunks.mockImplementation(async function* () { /* no audio */ });

    await lightFilterStage(ctx);

    expect(ctx.degraded).toMatchObject({ asr: true, asrReason: '未提取到可转写的音轨' });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('skips OCR for invalid frames while preserving the ASR path', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/c1/v.mp4', durationSec: 60 }),
    );
    mockFrameChunks([{ frameIndex: 0, timestampMs: 0, filePath: '/tmp/f0.jpg' }]);
    mocks.selectFrames.mockResolvedValue({
      frames: [{ frameIndex: 0, timestampMs: 0, score: 0.6, keep: true, reason: 'quality' }],
    });
    mocks.classify.mockResolvedValue({ items: [{ frameIndex: 0, category: 'invalid' }] });
    mocks.transcribe.mockResolvedValue({ available: false, provider: 'none', segments: [], reason: '未配置' });

    await lightFilterStage(ctx);

    expect(mocks.classify).toHaveBeenCalledWith([expect.objectContaining({ frameIndex: 0 })], expect.anything());
    expect(mocks.detectText).not.toHaveBeenCalled();
    expect(mocks.txCreateBlocks).not.toHaveBeenCalled();
    expect(mocks.extractAudioChunks).toHaveBeenCalled();
  });

  it('splits long-video inference into bounded batches and retains global frame timestamps', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/c1/v.mp4', durationSec: 300 }),
    );
    const frames = Array.from({ length: 121 }, (_, index) => ({
      frameIndex: index,
      timestampMs: index * 2_000,
      filePath: `/tmp/f${index}.jpg`,
    }));
    mockFrameChunks(frames);
    mockAudioChunks();
    mocks.selectFrames.mockImplementation(async (batch: Array<{ frameIndex: number; timestampMs: number }>) => ({
      frames: batch.map((frame) => ({ ...frame, score: 0.8, keep: true, reason: 'quality' })),
    }));
    mocks.classify.mockImplementation(async (batch: Array<{ frameIndex: number }>) => ({
      items: batch.map((frame) => ({ frameIndex: frame.frameIndex, category: 'unknown' })),
    }));
    mocks.detectText.mockImplementation(async (batch: Array<{ frameIndex: number }>) => ({
      items: batch.map((frame) => ({
        frameIndex: frame.frameIndex,
        blocks: [{ bbox: [0, 0, 1, 1] as [number, number, number, number], text: `frame-${frame.frameIndex}`, confidence: 0.9 }],
      })),
    }));
    mocks.transcribe.mockResolvedValue({
      available: true,
      provider: 'mock',
      segments: [{ seq: 0, startMs: 0, endMs: 6_000, text: '转写文本' }],
    });

    await lightFilterStage(ctx);

    expect(mocks.selectFrames).toHaveBeenCalledTimes(8);
    expect(mocks.selectFrames.mock.calls.map(([batch]) => batch.length)).toEqual([16, 16, 16, 16, 16, 16, 16, 9]);
    expect(mocks.classify.mock.calls.map(([batch]) => batch.length)).toEqual([16, 16, 16, 16, 16, 16, 16, 9]);
    expect(mocks.detectText).toHaveBeenCalledTimes(13);
    expect(mocks.detectText.mock.calls.every(([batch]) => batch.length === 1)).toBe(true);
    expect(mocks.txCreateBlocks).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ sequence: 0, text: 'frame-0', ref: { type: 'video', timestampSec: 0 } }),
        expect.objectContaining({ sequence: 12, text: 'frame-120', ref: { type: 'video', timestampSec: 240 } }),
      ]),
    });
  });

  it('stops visual calls after a fallback and still preserves the ASR path', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({ contentType: 'VIDEO', format: 'MP4', durationSec: 60 }));
    mockFrameChunks([{ frameIndex: 0, timestampMs: 0, filePath: '/tmp/f0.jpg' }]);
    mocks.selectFrames.mockImplementation(async (_frames: unknown, options: { onFallback: (reason: string) => void }) => {
      options.onFallback('TIMEOUT');
      return { frames: [] };
    });
    mocks.transcribe.mockResolvedValue({
      available: true, provider: 'xunfei', segments: [{ seq: 0, startMs: 0, endMs: 1_000, text: '转写文本' }],
    });

    await lightFilterStage(ctx);

    expect(ctx.degraded.infer).toBe(true);
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.detectText).not.toHaveBeenCalled();
    expect(mocks.txDeleteBlocks).not.toHaveBeenCalled();
    expect(mocks.txCreateTranscript).toHaveBeenCalled();
  });

  it('refreshes only visual evidence when a completed video has full transcription', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({
      contentType: 'VIDEO', format: 'MP4', durationSec: 60, understandingStatus: 'COMPLETED',
    }));
    mocks.transcriptFindFirst
      .mockResolvedValueOnce({ seq: 0, startMs: 500, endMs: 1_000, text: '开头' })
      .mockResolvedValueOnce({ seq: 10, startMs: 58_000, endMs: 60_000, text: '结尾' });
    mockFrameChunks([{ frameIndex: 0, timestampMs: 0, filePath: '/tmp/f0.jpg' }]);
    mocks.selectFrames.mockResolvedValue({
      frames: [{ frameIndex: 0, timestampMs: 0, score: 0.8, keep: true, reason: 'quality' }],
    });

    const result = await refreshVideoVisualEvidence('c1', 't1');

    expect(result).toEqual({ updated: true, textBlocks: 1, visualComplete: true });
    expect(mocks.txDeleteBlocks).toHaveBeenCalledWith({ where: { contentId: 'c1', source: 'FRAME' } });
    expect(mocks.extractAudioChunks).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.txDeleteTranscript).not.toHaveBeenCalled();
  });

  it('leaves existing visual and transcript artifacts untouched when visual-only refresh falls back', async () => {
    mocks.contentFindUnique.mockResolvedValue(makeContent({
      contentType: 'VIDEO', format: 'MP4', durationSec: 60, understandingStatus: 'COMPLETED',
    }));
    mocks.transcriptFindFirst
      .mockResolvedValueOnce({ seq: 0, startMs: 0, endMs: 1_000, text: '开头' })
      .mockResolvedValueOnce({ seq: 10, startMs: 58_000, endMs: 60_000, text: '结尾' });
    mockFrameChunks([{ frameIndex: 0, timestampMs: 0, filePath: '/tmp/f0.jpg' }]);
    mocks.selectFrames.mockImplementation(async (_frames: unknown, options: { onFallback: (reason: string) => void }) => {
      options.onFallback('INFER_UNAVAILABLE');
      return { frames: [] };
    });

    const result = await refreshVideoVisualEvidence('c1', 't1');

    expect(result).toEqual({ updated: false, textBlocks: 0, visualComplete: false });
    expect(mocks.txDeleteBlocks).not.toHaveBeenCalled();
    expect(mocks.txDeleteTranscript).not.toHaveBeenCalled();
    expect(mocks.extractAudioChunks).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('offsets ASR timestamps for later audio windows', async () => {
    mocks.contentFindUnique.mockResolvedValue(
      makeContent({ contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/c1/v.mp4', durationSec: 600 }),
    );
    mockFrameChunks([]);
    mocks.extractAudioChunks.mockImplementation(async function* () {
      yield { chunkIndex: 0, startSec: 0, durationSec: 300, directory: `/tmp/slp-test-a0-${randomUUID()}`, audioPath: '/tmp/a0.wav' };
      yield { chunkIndex: 1, startSec: 300, durationSec: 300, directory: `/tmp/slp-test-a1-${randomUUID()}`, audioPath: '/tmp/a1.wav' };
    });
    mocks.transcribe
      .mockResolvedValueOnce({ available: true, provider: 'mock', segments: [{ seq: 0, startMs: 0, endMs: 1_000, text: '第一段' }] })
      .mockResolvedValueOnce({ available: true, provider: 'mock', segments: [{ seq: 0, startMs: 0, endMs: 1_000, text: '第二段' }] });

    await lightFilterStage(ctx);

    expect(mocks.txCreateTranscript).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ seq: 0, startMs: 0, endMs: 1_000, text: '第一段' }),
        expect.objectContaining({ seq: 1, startMs: 300_000, endMs: 301_000, text: '第二段' }),
      ],
    });
  });
});
