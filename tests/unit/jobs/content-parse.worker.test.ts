import { Readable } from 'node:stream';
import { minimalEpub } from '../../fixtures/minimal-epub';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteBlocks: vi.fn(),
  createBlocks: vi.fn(),
  createJob: vi.fn(),
  putObject: vi.fn(),
  createReadUrl: vi.fn(),
  getObject: vi.fn(),
  localFilePath: vi.fn(),
  enqueue: vi.fn(),
  probeVideo: vi.fn(),
  extractCover: vi.fn(),
  isFfprobeAvailable: vi.fn(),
  scheduleCleanup: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.findUnique, update: mocks.update, updateMany: mocks.update },
    asyncJob: { create: mocks.createJob },
    $transaction: (fn: (tx: unknown) => unknown) => fn({
      learningContent: { update: mocks.update },
      asyncJob: { create: mocks.createJob },
      textBlock: { deleteMany: mocks.deleteBlocks, createMany: mocks.createBlocks },
    }),
  },
}));

vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    getStorage: () => ({
      localFilePath: mocks.localFilePath,
      getObject: mocks.getObject,
      putObject: mocks.putObject,
      createReadUrl: mocks.createReadUrl,
    }),
  };
});

vi.mock('@/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue');
  return { ...actual, enqueue: mocks.enqueue };
});

vi.mock('@/lib/media/ffmpeg', () => ({
  isFfprobeAvailable: mocks.isFfprobeAvailable,
  probeVideo: mocks.probeVideo,
  extractCover: mocks.extractCover,
  ffprobePath: () => 'ffprobe',
  ffmpegPath: () => 'ffmpeg',
}));

vi.mock('@/lib/jobs/async-job', () => ({
  startJob: vi.fn(async () => true),
  retryJob: vi.fn(async () => undefined),
  updateJobStage: vi.fn(async () => undefined),
  succeedJob: vi.fn(async () => undefined),
  failJob: vi.fn(async () => undefined),
}));

vi.mock('@/lib/jobs/cleanup', () => ({
  scheduleContentCleanup: mocks.scheduleCleanup,
}));

import { contentParseProcessor } from '@/lib/jobs/workers/content-parse.worker';
import { QueueName, type JobContext } from '@/lib/queue';
import { isRefInRange } from '@/lib/domain/content-ref';
import { QueueDispatchError } from '@/lib/jobs/dispatch';
import * as understanding from '@/lib/jobs/pipeline/understanding-pipeline';

/**
 * 视频解析 worker 单测（tasks.md §3.2）
 */

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return {
    name: QueueName.CONTENT_PARSE,
    attempts: 1,
    maxAttempts: 4,
    traceId: 't1',
    contentId: 'c1',
    ...overrides,
  };
}

const videoContent = {
  id: 'c1',
  contentType: 'VIDEO',
  storageKey: 'contents/c1/lesson.mp4',
};

const documentContent = {
  id: 'doc1',
  contentType: 'DOCUMENT',
  format: 'MD',
  storageKey: 'contents/doc1/notes.md',
};

describe('contentParseProcessor (video)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ ...videoContent });
    mocks.localFilePath.mockReturnValue('C:/tmp/lesson.mp4');
    mocks.isFfprobeAvailable.mockResolvedValue(true);
    mocks.probeVideo.mockResolvedValue({ durationSec: 12.6, width: 1920, height: 1080, codec: 'h264' });
    mocks.extractCover.mockResolvedValue(Buffer.from('jpeg-bytes'));
    mocks.putObject.mockResolvedValue(undefined);
    mocks.createReadUrl.mockResolvedValue({
      url: 'http://localhost/api/storage/object?key=covers/c1/cover.jpg',
      method: 'GET',
      expiresInSec: 3600,
      headers: {},
    });
    mocks.createJob.mockResolvedValue({ id: 'job_u1' });
    mocks.enqueue.mockResolvedValue('mem_1');
    mocks.update.mockResolvedValue({});
    mocks.deleteBlocks.mockResolvedValue({ count: 0 });
    mocks.createBlocks.mockResolvedValue({ count: 0 });
  });

  it('marks READY with metadata, stores a cover and enqueues understanding', async () => {
    await contentParseProcessor({ contentId: 'c1', traceId: 't1' }, makeCtx());

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          status: 'READY',
          durationSec: 13,
          // 存 storageKey（非预签名 URL），读取时再签发
          coverUrl: 'covers/c1/cover.jpg',
        }),
      }),
    );
    expect(mocks.putObject).toHaveBeenCalledWith('covers/c1/cover.jpg', expect.any(Buffer), {
      contentType: 'image/jpeg',
    });
    expect(mocks.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobType: 'UNDERSTANDING' }) }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      QueueName.UNDERSTANDING,
      expect.objectContaining({ contentId: 'c1', asyncJobId: 'job_u1' }),
    );
  });
  it('preserves parsed READY content when understanding delivery fails after compensation', async (): Promise<void> => {
    const spy = vi.spyOn(understanding, 'enqueueUnderstanding').mockRejectedValueOnce(new QueueDispatchError());
    try {
      await expect(contentParseProcessor({ contentId: 'c1', traceId: 't1' }, makeCtx({ maxAttempts: 1 }))).resolves.toBeUndefined();
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) }));
      expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
      expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('degrades to READY without metadata when ffprobe is unavailable', async () => {
    mocks.isFfprobeAvailable.mockResolvedValueOnce(false);

    await contentParseProcessor({ contentId: 'c1', traceId: 't1' }, makeCtx());

    expect(mocks.probeVideo).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'READY', durationSec: null, coverUrl: null }),
      }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(QueueName.UNDERSTANDING, expect.anything());
  });

  it('materializes a remote object to a temp file for the s3 driver', async () => {
    mocks.localFilePath.mockReturnValueOnce(null);
    mocks.getObject.mockResolvedValueOnce({ stream: Readable.from(Buffer.from('bytes')) });

    await contentParseProcessor({ contentId: 'c1', traceId: 't1' }, makeCtx());

    expect(mocks.getObject).toHaveBeenCalledWith('contents/c1/lesson.mp4');
    expect(mocks.probeVideo).toHaveBeenCalledWith(expect.stringContaining('slp-media-'));
  });

  it('marks FAILED only when retries are exhausted', async () => {
    mocks.probeVideo.mockRejectedValueOnce(new Error('probe failed'));

    await expect(
      contentParseProcessor({ contentId: 'c1', traceId: 't1' }, makeCtx({ attempts: 4, maxAttempts: 4 })),
    ).rejects.toThrow('probe failed');

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'FAILED', failReason: 'probe failed' },
    });
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith('c1', { derivedOnly: true });
  });

  it('does not mark FAILED while retries remain', async () => {
    mocks.probeVideo.mockRejectedValueOnce(new Error('transient'));

    await expect(
      contentParseProcessor({ contentId: 'c1', traceId: 't1' }, makeCtx({ attempts: 1, maxAttempts: 4 })),
    ).rejects.toThrow('transient');

    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
  });

  it('throws when the content record is missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(
      contentParseProcessor({ contentId: 'nope', traceId: 't1' }, makeCtx({ contentId: 'nope' })),
    ).rejects.toThrow('content not found');
  });

  it('extracts Markdown text blocks, records pageCount, then enqueues understanding', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'slp-document-test-'));
    const filePath = path.join(folder, 'notes.md');
    await writeFile(filePath, '# 端云协同\n\nMindSpore 负责轻量筛选。\n\n星火负责语义理解。', 'utf8');
    mocks.findUnique.mockResolvedValueOnce({ ...documentContent });
    mocks.localFilePath.mockReturnValueOnce(filePath);

    try {
      await contentParseProcessor({ contentId: 'doc1', traceId: 't1' }, makeCtx({ contentId: 'doc1' }));

      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'doc1' },
        data: expect.objectContaining({ status: 'READY', pageCount: 1 }),
      }));
      expect(mocks.createBlocks).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ source: 'MD', sequence: 0, text: '# 端云协同' }),
          expect.objectContaining({ source: 'MD', sequence: 1, text: 'MindSpore 负责轻量筛选。' }),
          expect.objectContaining({ source: 'MD', sequence: 2, text: '星火负责语义理解。' }),
        ],
      });
      expect(mocks.enqueue).toHaveBeenCalledWith(
        QueueName.UNDERSTANDING,
        expect.objectContaining({ contentId: 'doc1' }),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it.each(['PNG', 'JPEG'])('makes %s OCR page 1 valid before enqueueing', async (format: string): Promise<void> => {
    mocks.findUnique.mockResolvedValueOnce({ ...documentContent, format });
    await contentParseProcessor({ contentId: 'doc1', traceId: 't1' }, makeCtx({ contentId: 'doc1' }));
    const data = mocks.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'READY', durationSec: null, pageCount: 1 });
    expect(isRefInRange({ type: 'document', page: 1, blockIndex: 0 }, data)).toBe(true);
    expect(isRefInRange({ type: 'document', page: 2 }, data)).toBe(false);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]);
    expect(mocks.createBlocks).not.toHaveBeenCalled();
    expect(mocks.probeVideo).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(QueueName.UNDERSTANDING, expect.objectContaining({ contentId: 'doc1' }));
  });
});


describe('EPUB metadata-only parsing', (): void => {
  beforeEach((): void => { vi.clearAllMocks(); mocks.update.mockResolvedValue({ count: 1 }); });
  it('creates a reading index with no invented page count, text-block rewrite or AI enqueue', async (): Promise<void> => {
    const bytes = minimalEpub(); mocks.findUnique.mockResolvedValue({ ...documentContent, format: 'EPUB', fileSizeBytes: BigInt(bytes.length), bookRevision: 0 });
    mocks.getObject.mockResolvedValue({ stream: Readable.from(bytes) });
    await contentParseProcessor({ contentId: 'doc1', traceId: 'epub', jobId: 'epub-job' }, makeCtx());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doc1', bookRevision: 0 }, data: expect.objectContaining({ pageCount: null, bookState: expect.objectContaining({ format: 'EPUB', unitCount: 28, units: {} }) }) }));
    expect(mocks.createBlocks).not.toHaveBeenCalled(); expect(mocks.deleteBlocks).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('does not reset reading state or reread the archive on duplicate completion', async (): Promise<void> => {
    mocks.findUnique.mockResolvedValue({ ...documentContent, format: 'EPUB', fileSizeBytes: 1n, bookRevision: 3 });
    await contentParseProcessor({ contentId: 'doc1', traceId: 'epub', jobId: 'epub-job' }, makeCtx());
    expect(mocks.getObject).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
