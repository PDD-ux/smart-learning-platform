import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoredRow = Record<string, unknown>;

const store = vi.hoisted(() => {
  const contents = new Map<string, StoredRow>();
  const textBlocks: StoredRow[] = [];
  const transcripts: StoredRow[] = [];
  const points: StoredRow[] = [];
  const cards: StoredRow[] = [];
  const graphNodes: StoredRow[] = [];
  const jobs = new Map<string, StoredRow>();
  let pointSequence = 0;

  function removeByContent(rows: StoredRow[], contentId: string): void {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].contentId === contentId) rows.splice(index, 1);
    }
  }

  const tx = {
    textBlock: {
      deleteMany: async ({ where }: { where: { contentId: string } }): Promise<{ count: number }> => {
        removeByContent(textBlocks, where.contentId);
        return { count: 0 };
      },
      createMany: async ({ data }: { data: StoredRow[] }): Promise<{ count: number }> => {
        textBlocks.push(...data);
        return { count: data.length };
      },
    },
    transcriptSegment: {
      deleteMany: async ({ where }: { where: { contentId: string } }): Promise<{ count: number }> => {
        removeByContent(transcripts, where.contentId);
        return { count: 0 };
      },
      createMany: async ({ data }: { data: StoredRow[] }): Promise<{ count: number }> => {
        transcripts.push(...data);
        return { count: data.length };
      },
    },
    knowledgePoint: {
      deleteMany: async ({ where }: { where: { contentId: string } }): Promise<{ count: number }> => {
        removeByContent(points, where.contentId);
        return { count: 0 };
      },
      create: async ({ data }: { data: StoredRow }): Promise<StoredRow> => {
        const point = { id: `point_${++pointSequence}`, ...data, createdAt: new Date() };
        points.push(point);
        return point;
      },
    },
    graphNode: {
      upsert: async ({ create }: { create: StoredRow }): Promise<StoredRow> => {
        graphNodes.push(create);
        return create;
      },
    },
    flashcard: {
      deleteMany: async ({ where }: { where: { contentId: string } }): Promise<{ count: number }> => {
        removeByContent(cards, where.contentId);
        return { count: 0 };
      },
      create: async ({ data }: { data: StoredRow }): Promise<StoredRow> => {
        cards.push(data);
        return data;
      },
    },
  };

  return {
    contents,
    textBlocks,
    transcripts,
    points,
    cards,
    graphNodes,
    jobs,
    reset(): void {
      contents.clear();
      textBlocks.length = 0;
      transcripts.length = 0;
      points.length = 0;
      cards.length = 0;
      graphNodes.length = 0;
      jobs.clear();
      pointSequence = 0;
    },
    prisma: {
      learningContent: {
        findUnique: async ({ where }: { where: { id: string } }): Promise<StoredRow | null> =>
          contents.get(where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: StoredRow }): Promise<StoredRow> => {
          const content = contents.get(where.id);
          if (!content) throw new Error(`content missing: ${where.id}`);
          const updated = { ...content, ...data };
          contents.set(where.id, updated);
          return updated;
        },
      },
      transcriptSegment: {
        findMany: async ({ where }: { where: { contentId: string } }): Promise<StoredRow[]> =>
          transcripts.filter((item) => item.contentId === where.contentId),
      },
      textBlock: {
        findMany: async ({ where }: { where: { contentId: string } }): Promise<StoredRow[]> =>
          textBlocks.filter((item) => item.contentId === where.contentId),
      },
      note: { findMany: async (): Promise<StoredRow[]> => [] },
      knowledgePoint: {
        findMany: async ({ where }: { where: { contentId: string } }): Promise<StoredRow[]> =>
          points.filter((item) => item.contentId === where.contentId),
      },
      generatedNote: {
        upsert: async ({ create }: { create: StoredRow }): Promise<StoredRow> => create,
      },
      asyncJob: {
        update: async ({ where, data }: { where: { id: string }; data: StoredRow }): Promise<StoredRow> => {
          const existing = jobs.get(where.id) ?? { id: where.id };
          const updated = { ...existing, ...data };
          jobs.set(where.id, updated);
          return updated;
        },
      },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>): Promise<unknown> => callback(tx),
    },
  };
});

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  classify: vi.fn(),
  selectFrames: vi.fn(),
  detectText: vi.fn(),
  extractFrameChunks: vi.fn(),
  extractAudioChunks: vi.fn(),
  transcribe: vi.fn(),
  extractJson: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: store.prisma }));

vi.mock('@/lib/ai/gateway', () => ({
  getInferenceGateway: () => ({
    health: mocks.health,
    classify: mocks.classify,
    selectFrames: mocks.selectFrames,
    detectText: mocks.detectText,
  }),
}));

vi.mock('@/lib/ai/asr', () => ({
  getAsrStatus: () => ({ available: true, provider: 'xunfei' }),
  transcribe: mocks.transcribe,
  alignSegments: (segments: StoredRow[]) => segments,
}));

vi.mock('@/lib/ai/spark', () => ({
  AiError: class AiError extends Error {},
  extractJson: mocks.extractJson,
}));

vi.mock('@/lib/media/ffmpeg', () => ({
  isFfmpegAvailable: vi.fn(async () => true),
  extractFrameChunks: mocks.extractFrameChunks,
  extractAudioChunks: mocks.extractAudioChunks,
}));

vi.mock('@/lib/media/materialize', () => ({
  materializeObject: vi.fn(async () => ({ filePath: '/tmp/integration-video.mp4', cleanup: async () => undefined })),
}));

vi.mock('@/lib/media/frame-bytes', () => ({ readFileBase64: vi.fn(async () => 'ZmFrZS1mcmFtZQ==') }));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    getStorage: () => ({ getObject: async () => ({ stream: Readable.from(Buffer.from('image-bytes')) }) }),
  };
});

import { registerDeepExtractStage } from '@/lib/jobs/pipeline/deep-extract.stage';
import { registerLightFilterStage } from '@/lib/jobs/pipeline/light-filter.stage';
import { registerProductGenStage } from '@/lib/jobs/pipeline/product-gen.stage';
import {
  __resetPipelineStagesForTest,
  runUnderstandingPipeline,
} from '@/lib/jobs/pipeline/understanding-pipeline';
import type { JobContext } from '@/lib/queue';

function context(contentId: string): JobContext {
  return {
    name: 'UNDERSTANDING',
    attempts: 1,
    maxAttempts: 1,
    traceId: `trace-${contentId}`,
    contentId,
  };
}

function registerRealStages(): void {
  __resetPipelineStagesForTest();
  registerLightFilterStage();
  registerDeepExtractStage();
  registerProductGenStage();
}

describe('understanding pipeline integration', () => {
  beforeEach(() => {
    store.reset();
    vi.clearAllMocks();
    registerRealStages();
    mocks.health.mockRejectedValue(new Error('mindspore unavailable'));
    mocks.classify.mockImplementation(async (frames: Array<{ frameIndex: number }>) => ({
      items: frames.map((frame) => ({ frameIndex: frame.frameIndex, category: 'unknown' })),
    }));
    mocks.selectFrames.mockImplementation(async (frames: Array<{ frameIndex: number; timestampMs?: number }>) => ({
      frames: frames.map((frame, index) => ({
        frameIndex: frame.frameIndex,
        timestampMs: frame.timestampMs ?? 0,
        score: index === 0 ? 0.6 : 0.3,
        keep: index === 0,
        reason: index === 0 ? 'uniform' : 'uniform-dropped',
      })),
    }));
    mocks.detectText.mockImplementation(async (frames: Array<{ frameIndex: number }>) => ({
      items: frames.map((frame) => ({
        frameIndex: frame.frameIndex,
        blocks: [{ bbox: [0, 0, 10, 10], text: `文本-${frame.frameIndex}`, confidence: 0.9 }],
      })),
    }));
    mocks.extractFrameChunks.mockImplementation(async function* () {
      yield {
        chunkIndex: 0,
        startSec: 0,
        durationSec: 12,
        directory: `/tmp/slp-integration-frames-${randomUUID()}`,
        frames: [
          { frameIndex: 0, timestampMs: 0, filePath: '/tmp/frame-0.jpg' },
          { frameIndex: 1, timestampMs: 2_000, filePath: '/tmp/frame-1.jpg' },
        ],
      };
    });
    mocks.extractAudioChunks.mockImplementation(async function* () {
      yield {
        chunkIndex: 0,
        startSec: 0,
        durationSec: 12,
        directory: `/tmp/slp-integration-audio-${randomUUID()}`,
        audioPath: '/tmp/audio.wav',
      };
    });
    mocks.transcribe.mockResolvedValue({
      available: true,
      provider: 'xunfei',
      segments: [{ seq: 0, startMs: 0, endMs: 2_000, text: '视频转写内容' }],
    });
    mocks.extractJson.mockImplementation(async (messages: Array<{ content: string }>) => {
      if (messages[0]?.content.includes('结构化助手') || messages[0]?.content.includes('课堂重点选择助手')) {
        return {
          data: {
            points: [{
              title: '端云协同',
              summary: '轻量推理筛选后交由大模型完成语义理解。',
              tags: ['MindSpore', 'AI'],
              importance: 5,
              refs: [{ type: 'video', timestampSec: 0 }],
            }],
          },
        };
      }
      return {
        data: {
          cards: [{ pointIndex: 0, front: '端云协同是什么？', back: '先轻量筛选，再进行语义理解。', hint: '两阶段' }],
        },
      };
    });
  });

  afterEach(() => __resetPipelineStagesForTest());

  it('marks the pipeline FAILED when cards fail after successful extraction', async (): Promise<void> => {
    const id = 'card_failed_video';
    store.contents.set(id, { id, ownerId: 'learner_1', contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/card_failed_video/lesson.mp4', durationSec: 12, status: 'READY', understandingStatus: 'NONE' });
    mocks.extractJson.mockResolvedValueOnce({ data: { points: [{ title: '真实知识点', summary: '真实来源摘要', tags: [], importance: 3, refs: [{ type: 'video', timestampSec: 0 }] }] } })
      .mockRejectedValueOnce(new Error('card generation unavailable'));
    await expect(runUnderstandingPipeline({ contentId: id, traceId: 'trace-cards', asyncJobId: 'card_failed_job' }, context(id))).rejects.toThrow('card generation unavailable');
    expect(store.contents.get(id)).toMatchObject({ status: 'READY', understandingStatus: 'FAILED' });
    expect(store.points).toHaveLength(1);
    expect(store.cards).toHaveLength(0);
    expect(store.jobs.get('card_failed_job')).toMatchObject({ errorReason: 'card generation unavailable', stage: 'product-gen' });
  });

  it.each(['missing model key', 'model timeout', 'invalid model output'])('marks real stages FAILED while retaining parsed evidence and old products: %s', async (reason): Promise<void> => {
    const id = 'failed_video';
    store.contents.set(id, { id, ownerId: 'learner_1', contentType: 'VIDEO', format: 'MP4', storageKey: 'contents/failed_video/lesson.mp4', durationSec: 12, status: 'READY', understandingStatus: 'NONE' });
    store.points.push({ id: 'old_point', contentId: id, title: '原知识点' });
    store.cards.push({ id: 'old_card', contentId: id, pointId: 'old_point' });
    mocks.extractJson.mockRejectedValueOnce(new Error(reason));
    await expect(runUnderstandingPipeline({ contentId: id, traceId: 'trace-failed', asyncJobId: 'failed_job' }, context(id))).rejects.toThrow(reason);
    expect(store.contents.get(id)).toMatchObject({ status: 'READY', understandingStatus: 'FAILED' });
    expect(store.transcripts).toHaveLength(1);
    expect(store.textBlocks).toHaveLength(1);
    expect(store.points).toEqual([{ id: 'old_point', contentId: id, title: '原知识点' }]);
    expect(store.cards).toEqual([{ id: 'old_card', contentId: id, pointId: 'old_point' }]);
    expect(store.jobs.get('failed_job')).toMatchObject({ errorReason: expect.stringContaining(reason), stage: 'deep-extract' });
    expect(mocks.extractJson).toHaveBeenCalledTimes(1);
  });

  it('keeps a video pipeline running with uniform frame fallback and persists transcript, point, graph node, and flashcard', async () => {
    store.contents.set('video_1', {
      id: 'video_1',
      ownerId: 'learner_1',
      contentType: 'VIDEO',
      format: 'MP4',
      storageKey: 'contents/video_1/lesson.mp4',
      durationSec: 12,
      understandingStatus: 'NONE',
    });
    store.jobs.set('job_video', { id: 'job_video' });

    await runUnderstandingPipeline(
      { contentId: 'video_1', traceId: 'trace-video_1', asyncJobId: 'job_video' },
      context('video_1'),
    );

    expect(mocks.health).toHaveBeenCalled();
    expect(mocks.selectFrames).toHaveBeenCalledWith(
      [expect.objectContaining({ frameIndex: 0 }), expect.objectContaining({ frameIndex: 1 })],
      expect.objectContaining({ traceId: 'trace-video_1' }),
    );
    expect(store.textBlocks).toHaveLength(1);
    expect(store.textBlocks[0]).toMatchObject({ source: 'FRAME', text: '文本-0' });
    expect(store.transcripts).toHaveLength(1);
    expect(store.points).toHaveLength(1);
    expect(store.graphNodes).toHaveLength(1);
    expect(store.cards).toHaveLength(1);
    expect(store.cards[0]).toMatchObject({ pointId: 'point_1', status: 'NEW' });
    expect(store.contents.get('video_1')).toMatchObject({ understandingStatus: 'COMPLETED' });
  });

  it('runs the document image path through classify/OCR and persists the same semantic products', async () => {
    store.contents.set('image_1', {
      id: 'image_1',
      ownerId: 'learner_1',
      contentType: 'DOCUMENT',
      format: 'PNG',
      storageKey: 'contents/image_1/note.png',
      durationSec: null,
      understandingStatus: 'NONE',
    });
    store.jobs.set('job_image', { id: 'job_image' });

    await runUnderstandingPipeline(
      { contentId: 'image_1', traceId: 'trace-image_1', asyncJobId: 'job_image' },
      context('image_1'),
    );

    expect(mocks.classify).toHaveBeenCalledWith(
      [expect.objectContaining({ frameIndex: 0 })],
      expect.objectContaining({ traceId: 'trace-image_1' }),
    );
    expect(mocks.selectFrames).not.toHaveBeenCalled();
    expect(store.textBlocks).toHaveLength(1);
    expect(store.textBlocks[0]).toMatchObject({ source: 'OCR', text: '文本-0' });
    expect(store.transcripts).toHaveLength(0);
    expect(store.points).toHaveLength(1);
    expect(store.cards).toHaveLength(1);
    expect(store.contents.get('image_1')).toMatchObject({ understandingStatus: 'COMPLETED' });
  });
});
