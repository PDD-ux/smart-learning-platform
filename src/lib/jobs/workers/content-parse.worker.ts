import { ContentStatus, ContentType, Prisma, TextSource } from '@prisma/client';

import { extractCover, isFfprobeAvailable, probeVideo } from '@/lib/media/ffmpeg';
import { initializeBook, bookBytes } from '@/lib/books/source';
import { parseDocument } from '@/lib/media/document-parser';
import { materializeObject } from '@/lib/media/materialize';
import { prisma } from '@/lib/prisma';
import { type JobContext, type JobPayload } from '@/lib/queue';
import { buildCoverKey, getStorage } from '@/lib/storage';
import { scheduleContentCleanup } from '@/lib/jobs/cleanup';
import { enqueueUnderstanding } from '@/lib/jobs/pipeline/understanding-pipeline';
import { taskLogger } from '@/lib/jobs/task-logger';
import { QueueDispatchError } from '@/lib/jobs/dispatch';
import { runStage } from './lifecycle';

const IMAGE_FORMATS = new Set(['PNG', 'JPEG']);

/**
 * CONTENT_PARSE worker（tasks.md §3.2）
 * ------------------------------------------------------------
 * 视频解析：ffprobe 提取时长/分辨率/编码 → ffmpeg 抽封面 → 置 `已就绪`
 *          → 自动入队端云协同理解流水线（UNDERSTANDING）。
 * 失败：重试耗尽后置 `失败` 并记录 failReason。
 *
 * 降级（spec/03-ARCHITECTURE.md §3.4）：环境无 ffprobe 时，跳过元数据与封面，
 * 仍置 `已就绪` 并继续理解流水线，保证演示链路不被外部工具阻塞。
 *
 * 图文解析：PDF 文本层、Markdown/TXT 直读；图片交给理解流水线中的视觉通道。
 */

async function markFailed(contentId: string, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  await prisma.learningContent.update({
    where: { id: contentId },
    data: { status: ContentStatus.FAILED, failReason: reason.slice(0, 500) },
  });
}

/** 置 `已就绪` 并自动入队端云理解流水线 */
async function finalizeReady(
  contentId: string,
  traceId: string,
  data: { durationSec: number | null; coverRef: string | null; pageCount?: number },
): Promise<void> {
  await prisma.learningContent.update({
    where: { id: contentId },
    data: {
      status: ContentStatus.READY,
      failReason: null,
      durationSec: data.durationSec,
      coverUrl: data.coverRef,
      ...(data.pageCount === undefined ? {} : { pageCount: data.pageCount }),
    },
  });

  // 内容已就绪 → 自动入队端云协同理解流水线
  await queueUnderstandingAfterParse(contentId, traceId);
}

async function queueUnderstandingAfterParse(contentId: string, traceId: string): Promise<void> {
  try {
    await enqueueUnderstanding(contentId, traceId);
  } catch (error: unknown) {
    if (!(error instanceof QueueDispatchError)) throw error;
    taskLogger.warn('content parsed; understanding delivery failed and can be retried', { contentId, traceId });
  }
}

async function parseVideo(contentId: string, storageKey: string, traceId: string): Promise<void> {
  const storage = getStorage();
  const file = await materializeObject(storage, storageKey);
  try {
    if (!(await isFfprobeAvailable())) {
      taskLogger.warn('content-parse: ffprobe unavailable, degrade to metadata-less READY', {
        contentId,
      });
      await finalizeReady(contentId, traceId, { durationSec: null, coverRef: null });
      return;
    }

    const probe = await probeVideo(file.filePath);

    let coverRef: string | null = null;
    if (probe.durationSec && probe.durationSec > 0) {
      const cover = await extractCover(file.filePath, Math.min(1, probe.durationSec / 2));
      const coverKey = buildCoverKey(contentId);
      await storage.putObject(coverKey, cover, { contentType: 'image/jpeg' });
      // 存 storageKey（而非会过期的预签名 URL），读取时由 API 侧签发
      coverRef = coverKey;
    }

    await finalizeReady(contentId, traceId, {
      durationSec: probe.durationSec ? Math.round(probe.durationSec) : null,
      coverRef,
    });
  } finally {
    await file.cleanup();
  }
}

async function parseDocumentContent(
  content: { id: string; format: string; storageKey: string; fileSizeBytes: bigint; bookRevision?: number },
  traceId: string,
): Promise<void> {
  if (content.format === 'EPUB') {
    if ((content.bookRevision ?? 0) > 0) return;
    const state = await initializeBook(await bookBytes(content.storageKey, content.fileSizeBytes), 'EPUB');
    // Commit once; duplicate/late parse work cannot erase a learner's saved book state.
    await prisma.learningContent.updateMany({ where: { id: content.id, bookRevision: 0 }, data: { status: ContentStatus.READY, failReason: null, pageCount: null, bookState: state as unknown as Prisma.InputJsonValue, bookRevision: { increment: 1 } } });
    return;
  }
  const storage = getStorage();
  const materialized = await materializeObject(storage, content.storageKey);
  try {
    const bytes = await (await import('node:fs/promises')).readFile(materialized.filePath);
    const parsed = await parseDocument(bytes, content.format);
    const source = content.format === 'PDF' ? TextSource.PDF : TextSource.MD;
    const blocks = parsed.pages
      .flatMap((page, pageIndex) => page
        .split(/\n{2,}/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text, blockIndex) => ({
          contentId: content.id,
          source,
          sequence: pageIndex * 10_000 + blockIndex,
          ref: { type: 'document', page: pageIndex + 1, blockIndex } as Prisma.InputJsonValue,
          text,
        })))
      .sort((left, right) => left.sequence - right.sequence)
      .map((block, sequence) => ({ ...block, sequence }));

    await prisma.$transaction(async (tx) => {
      await tx.textBlock.deleteMany({ where: { contentId: content.id } });
      if (blocks.length > 0) await tx.textBlock.createMany({ data: blocks });
      await tx.learningContent.update({
        where: { id: content.id },
        data: { status: ContentStatus.READY, failReason: null, pageCount: parsed.pageCount },
      });
    });

    if (parsed.requiresVisualOcr) {
      taskLogger.warn('content-parse: scanned PDF has no readable text layer; queued for visual OCR stage', {
        contentId: content.id,
        traceId,
        pageCount: parsed.pageCount,
      });
    }
    await queueUnderstandingAfterParse(content.id, traceId);
  } finally {
    await materialized.cleanup();
  }
}

export async function contentParseProcessor(payload: JobPayload, ctx: JobContext): Promise<void> {
  await runStage(payload, ctx, 'content-parse', async () => {
    const content = await prisma.learningContent.findUnique({
      where: { id: payload.contentId },
    });
    if (!content) {
      throw new Error(`content not found: ${payload.contentId}`);
    }

    try {
      if (content.contentType === ContentType.VIDEO) {
        await parseVideo(content.id, content.storageKey, payload.traceId);
      } else if (IMAGE_FORMATS.has(content.format.toUpperCase())) {
        // 图片是二进制视觉资料，不应进入文档 UTF-8 文本解析器；
        // 置为 READY 后由理解流水线的 light-filter 图片分支执行分类与 OCR。
        await finalizeReady(content.id, payload.traceId, { durationSec: null, coverRef: null, pageCount: 1 });
      } else {
        await parseDocumentContent(content, payload.traceId);
      }
    } catch (err) {
      // 仅在重试耗尽时落 `失败`，避免瞬时错误把状态提前置失败
      if (ctx.attempts >= ctx.maxAttempts) {
        await markFailed(content.id, err);
        // 异步清理派生残留（关键帧/封面），保留源文件供学习者重试
        void scheduleContentCleanup(content.id, { derivedOnly: true });
      }
      throw err;
    }
  });
}
