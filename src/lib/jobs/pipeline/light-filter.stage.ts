import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ContentType, type LearningContent, type Prisma, TextSource } from '@prisma/client';

import { alignSegments, transcribe } from '@/lib/ai/asr';
import { getInferenceGateway, type FrameInput } from '@/lib/ai/gateway';
import { extractAudioChunks, extractFrameChunks, isFfmpegAvailable } from '@/lib/media/ffmpeg';
import { readFrameBatches } from '@/lib/media/frame-batches';
import { parseDocument } from '@/lib/media/document-parser';
import { readFileBase64 } from '@/lib/media/frame-bytes';
import { materializeObject } from '@/lib/media/materialize';
import { isPdfRendererAvailable, renderPdfPages } from '@/lib/media/pdf-render';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { taskLogger } from '@/lib/jobs/task-logger';

import { registerPipelineStage, type PipelineStageContext } from './understanding-pipeline';

/**
 * 阶段 A：端侧轻量筛选（tasks.md §6.3）
 * ------------------------------------------------------------
 * 图像理解为主：
 *   - 图片/拍照（PNG/JPEG）：`/classify` + `/detect_text` → `TextBlock(source=ocr)`
 *   - 视频：每 2s 抽帧 → `/select_frames` 筛选 → 保留帧 `/detect_text` → `TextBlock(source=FRAME)`
 *     分段抽音轨 → ASR → `TranscriptSegment`（按 seq 有序，保留失败前已成功的分段）
 *   - PDF/MD/TXT 文本层由内容解析 worker（§3.2）预先写入；扫描页视觉 OCR
 *     仍由 §6.3 P1 补齐，本阶段不覆盖既有文档文本块。
 *
 * 幂等：视觉处理完整时替换视频 TextBlock；视觉降级时保留既有画面依据。
 *       获得新转写时整批替换 TranscriptSegment；若新转写为零则保留之前的转写。
 * 降级：ffmpeg 不可用 → 跳过视频抽帧/音轨；ASR 不可用 → 保留已成功分段并使理解任务失败。
 */

const FRAME_INTERVAL_SEC = 2;
const VIDEO_INFER_BATCH_FRAMES = 16;
const VIDEO_INFER_TIMEOUT_MS = 30_000;
const VIDEO_OCR_TIMEOUT_MS = 60_000;
const VIDEO_OCR_KEYFRAME_INTERVAL_MS = 20_000;
const IMAGE_FORMATS = new Set(['PNG', 'JPEG']);
const IMAGE_OCR_TIMEOUT_MS = 30_000;

type TextBlockInput = {
  source: TextSource;
  sequence: number;
  ref: Prisma.InputJsonValue;
  text: string;
};

async function replaceTextBlocks(contentId: string, blocks: TextBlockInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.textBlock.deleteMany({ where: { contentId } });
    if (blocks.length > 0) {
      await tx.textBlock.createMany({
        data: blocks.map((b) => ({
          contentId,
          source: b.source,
          sequence: b.sequence,
          ref: b.ref,
          text: b.text,
        })),
      });
    }
  });
}

/** 仅替换扫描 PDF 的 OCR 产物，保留内容解析 worker 写入的 PDF 文本层。 */
async function replacePdfOcrTextBlocks(contentId: string, blocks: TextBlockInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.textBlock.deleteMany({ where: { contentId, source: TextSource.OCR } });
    if (blocks.length > 0) {
      await tx.textBlock.createMany({
        data: blocks.map((block) => ({
          contentId,
          source: TextSource.OCR,
          sequence: block.sequence,
          ref: block.ref,
          text: block.text,
        })),
      });
    }
  });
}

async function replaceVideoArtifacts(
  contentId: string,
  blocks: TextBlockInput[],
  segments: { seq: number; startMs: number; endMs: number; text: string }[],
  replaceVisual: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (replaceVisual) {
      await tx.textBlock.deleteMany({ where: { contentId } });
      if (blocks.length > 0) {
        await tx.textBlock.createMany({
          data: blocks.map((block) => ({
            contentId,
            source: block.source,
            sequence: block.sequence,
            ref: block.ref,
            text: block.text,
          })),
        });
      }
    }
    if (segments.length > 0) {
      await tx.transcriptSegment.deleteMany({ where: { contentId } });
      await tx.transcriptSegment.createMany({
        data: segments.map((s) => ({
          contentId,
          seq: s.seq,
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
        })),
      });
    }
  });
}

async function replaceVideoFrameBlocks(contentId: string, blocks: TextBlockInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.textBlock.deleteMany({ where: { contentId, source: TextSource.FRAME } });
    await tx.textBlock.createMany({
      data: blocks.map((block) => ({
        contentId,
        source: TextSource.FRAME,
        sequence: block.sequence,
        ref: block.ref,
        text: block.text,
      })),
    });
  });
}

async function readObjectAsBase64(storageKey: string): Promise<string> {
  const { stream } = await getStorage().getObject(storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('base64');
}

/** 图片/拍照：图像分类 + 文字区域检测 → TextBlock(ocr) */
async function runImageLightFilter(content: LearningContent, ctx: PipelineStageContext): Promise<void> {
  const frame: FrameInput = {
    frameIndex: 0,
    timestampMs: 0,
    imageBase64: await readObjectAsBase64(content.storageKey),
  };
  const gateway = getInferenceGateway();
  const classified = await gateway.classify([frame], { traceId: ctx.traceId });
  const detected = await gateway.detectText([frame], {
    traceId: ctx.traceId,
    timeoutMs: IMAGE_OCR_TIMEOUT_MS,
  });

  let sequence = 0;
  const blocks: TextBlockInput[] = [];
  for (const item of detected.items) {
    item.blocks.forEach((block, index) => {
      blocks.push({
        source: TextSource.OCR,
        sequence: sequence++,
        ref: { type: 'document', page: 1, blockIndex: index } as Prisma.InputJsonValue,
        text: block.text,
      });
    });
  }
  await replaceTextBlocks(content.id, blocks);

  taskLogger.info('light-filter: image processed', {
    contentId: content.id,
    traceId: ctx.traceId,
    category: classified.items[0]?.category,
    textBlocks: blocks.length,
  });
}

/** 扫描 PDF：仅渲染无文本层页面，再调用 MindSpore 文字检测。 */
async function runScannedPdfLightFilter(content: LearningContent, ctx: PipelineStageContext): Promise<void> {
  if (!(await isPdfRendererAvailable())) {
    taskLogger.warn('light-filter: PDF renderer unavailable, scanned pages skipped', {
      contentId: content.id,
      traceId: ctx.traceId,
    });
    return;
  }

  const storage = getStorage();
  const materialized = await materializeObject(storage, content.storageKey);
  const workDir = path.join(tmpdir(), `slp-pdf-pages-${randomUUID()}`);
  try {
    const parsed = await parseDocument(await (await import('node:fs/promises')).readFile(materialized.filePath), content.format);
    if (parsed.pagesNeedingVisualOcr.length === 0) return;

    const rendered = await renderPdfPages(materialized.filePath, parsed.pagesNeedingVisualOcr, workDir);
    const frames: FrameInput[] = await Promise.all(rendered.map(async (page, index) => ({
      frameIndex: index,
      timestampMs: 0,
      imageBase64: await readFileBase64(page.filePath),
    })));
    const detected = await getInferenceGateway().detectText(frames, { traceId: ctx.traceId });
    const pageForFrame = new Map(rendered.map((item, index) => [index, item.page]));
    const blocks: TextBlockInput[] = [];
    for (const item of detected.items) {
      const page = pageForFrame.get(item.frameIndex);
      if (!page) continue;
      item.blocks.forEach((block, index) => {
        if (!block.text.trim()) return;
        blocks.push({
          source: TextSource.OCR,
          sequence: 1_000_000 + page * 10_000 + index,
          ref: { type: 'document', page, blockIndex: 10_000 + index } as Prisma.InputJsonValue,
          text: block.text,
        });
      });
    }
    await replacePdfOcrTextBlocks(content.id, blocks);
    taskLogger.info('light-filter: scanned PDF pages processed', {
      contentId: content.id,
      traceId: ctx.traceId,
      pages: rendered.length,
      textBlocks: blocks.length,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await materialized.cleanup();
  }
}

type VideoVisualResult = {
  blocks: TextBlockInput[];
  frameCount: number;
  keptFrameCount: number;
  invalidSkipped: number;
  ocrFrames: number;
  complete: boolean;
};

/** 所有候选帧做质量/类别判断；每 20 秒选分数最高的一帧执行有界 OCR。 */
async function collectVideoFrameBlocks(
  content: LearningContent,
  filePath: string,
  workDir: string,
  ctx: PipelineStageContext,
): Promise<VideoVisualResult> {
  const gateway = getInferenceGateway();
  const result: VideoVisualResult = {
    blocks: [], frameCount: 0, keptFrameCount: 0, invalidSkipped: 0, ocrFrames: 0, complete: true,
  };
  let fallbackReason: string | undefined;
  const onFallback = (reason: string): void => {
    fallbackReason ??= reason;
    result.complete = false;
    ctx.degraded.infer = true;
  };

  for await (const chunk of extractFrameChunks(filePath, FRAME_INTERVAL_SEC, workDir, content.durationSec)) {
    try {
      const frameByIndex = new Map(chunk.frames.map((frame) => [frame.frameIndex, frame]));
      const bestByWindow = new Map<number, { frameIndex: number; score: number }>();
      for await (const frameInputs of readFrameBatches(chunk.frames, { maxFrames: VIDEO_INFER_BATCH_FRAMES })) {
        result.frameCount += frameInputs.length;
        const selected = await gateway.selectFrames(frameInputs, {
          traceId: ctx.traceId, timeoutMs: VIDEO_INFER_TIMEOUT_MS, onFallback,
        });
        if (!result.complete) break;
        const selectedByIndex = new Map(selected.frames.filter((frame) => frame.keep).map((frame) => [frame.frameIndex, frame]));
        const qualityFrames = frameInputs.filter((frame) => selectedByIndex.has(frame.frameIndex));
        if (qualityFrames.length === 0) continue;
        const classified = await gateway.classify(qualityFrames, {
          traceId: ctx.traceId, timeoutMs: VIDEO_INFER_TIMEOUT_MS, onFallback,
        });
        if (!result.complete) break;
        const categoryByFrame = new Map(classified.items.map((item) => [item.frameIndex, item.category]));
        for (const frame of qualityFrames) {
          if (categoryByFrame.get(frame.frameIndex) === 'invalid') {
            result.invalidSkipped += 1;
            continue;
          }
          // unknown 可能是模型未就绪，不主动丢弃课堂依据。
          result.keptFrameCount += 1;
          const window = Math.floor((frame.timestampMs ?? 0) / VIDEO_OCR_KEYFRAME_INTERVAL_MS);
          const score = selectedByIndex.get(frame.frameIndex)?.score ?? 0;
          const current = bestByWindow.get(window);
          if (!current || score > current.score) bestByWindow.set(window, { frameIndex: frame.frameIndex, score });
        }
      }
      if (!result.complete) break;

      const keyframes = [...bestByWindow.values()]
        .map((choice) => frameByIndex.get(choice.frameIndex))
        .filter((frame): frame is NonNullable<typeof frame> => frame !== undefined)
        .sort((left, right) => left.timestampMs - right.timestampMs);
      for (const frame of keyframes) {
        const detected = await gateway.detectText([{
          frameIndex: frame.frameIndex,
          timestampMs: frame.timestampMs,
          imageBase64: await readFileBase64(frame.filePath),
        }], { traceId: ctx.traceId, timeoutMs: VIDEO_OCR_TIMEOUT_MS, onFallback });
        if (!result.complete) break;
        result.ocrFrames += 1;
        for (const block of detected.items[0]?.blocks ?? []) {
          if (!block.text.trim()) continue;
          result.blocks.push({
            source: TextSource.FRAME,
            sequence: result.blocks.length,
            ref: { type: 'video', timestampSec: Math.round(frame.timestampMs / 1_000) } as Prisma.InputJsonValue,
            text: block.text,
          });
        }
      }
      taskLogger.info('light-filter: video frame chunk processed', {
        contentId: content.id, traceId: ctx.traceId, chunkIndex: chunk.chunkIndex,
        startSec: chunk.startSec, frames: chunk.frames.length, ocrFrames: keyframes.length,
        textBlocks: result.blocks.length,
      });
      if (!result.complete) break;
    } finally {
      await rm(chunk.directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  if (!result.complete) {
    taskLogger.warn('light-filter: video visual processing degraded', {
      contentId: content.id, traceId: ctx.traceId, reason: fallbackReason,
      framesProcessed: result.frameCount, retainedTextBlocks: result.blocks.length,
    });
  }
  return result;
}

/** 视频：抽帧筛选 + 关键帧 OCR + 音轨 ASR */
async function runVideoLightFilter(content: LearningContent, ctx: PipelineStageContext): Promise<void> {
  if (!(await isFfmpegAvailable())) {
    ctx.degraded.asr = true;
    ctx.degraded.asrReason = 'FFmpeg 不可用，无法提取视频音轨';
    taskLogger.warn('light-filter: ffmpeg unavailable, skip frame/audio extraction', {
      contentId: content.id,
      traceId: ctx.traceId,
    });
    return;
  }

  const materialized = await materializeObject(getStorage(), content.storageKey);
  const workDir = path.join(tmpdir(), `slp-frames-${randomUUID()}`);

  try {
    const visual = await collectVideoFrameBlocks(content, materialized.filePath, workDir, ctx);

    // 按音频窗口依次转写，转写器只持有当前窗口，时间戳回填到整段视频轴。
    const transcriptSegments: Awaited<ReturnType<typeof transcribe>>['segments'] = [];
    let asrCompleted = true;
    let asrChunkCount = 0;
    let asrProvider = 'none';
    let asrFailureReason: string | undefined;
    try {
      for await (const chunk of extractAudioChunks(
        materialized.filePath,
        workDir,
        content.durationSec,
      )) {
        try {
          asrChunkCount += 1;
          const asr = await transcribe({
            contentId: content.id,
            traceId: ctx.traceId,
            audio: { audioPath: chunk.audioPath, durationSec: chunk.durationSec },
          });
          asrProvider = asr.provider;
          if (!asr.available) {
            asrCompleted = false;
            asrFailureReason = `第 ${chunk.chunkIndex + 1} 段（${chunk.startSec} 秒起）转写失败：${asr.reason ?? '服务未返回原因'}`;
            taskLogger.warn('light-filter: audio chunk failed', {
              contentId: content.id,
              traceId: ctx.traceId,
              chunkIndex: chunk.chunkIndex,
              startSec: chunk.startSec,
              provider: asr.provider,
              reason: asr.reason,
            });
            break;
          }
          const offsetMs = Math.round(chunk.startSec * 1_000);
          transcriptSegments.push(...asr.segments.map((segment) => ({
            ...segment,
            startMs: segment.startMs + offsetMs,
            endMs: segment.endMs + offsetMs,
          })));
          taskLogger.info('light-filter: audio chunk processed', {
            contentId: content.id,
            traceId: ctx.traceId,
            chunkIndex: chunk.chunkIndex,
            startSec: chunk.startSec,
            provider: asr.provider,
            segments: asr.segments.length,
          });
        } finally {
          await rm(chunk.directory, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    } catch (error) {
      asrCompleted = false;
      const reason = error instanceof Error ? error.message : String(error);
      asrFailureReason = `第 ${asrChunkCount + 1} 段音轨提取失败：${reason}`;
      taskLogger.warn('light-filter: audio chunk extraction failed', {
        contentId: content.id,
        traceId: ctx.traceId,
        chunkIndex: asrChunkCount,
        reason,
      });
    }

    const alignedSegments = alignSegments(transcriptSegments);
    const asrAvailable = asrCompleted && asrChunkCount > 0 && alignedSegments.length > 0;
    if (!asrAvailable) {
      ctx.degraded.asr = true;
      ctx.degraded.asrReason = asrFailureReason ?? (asrChunkCount === 0
        ? '未提取到可转写的音轨'
        : 'ASR 未返回有效转写文本');
      taskLogger.warn('light-filter: ASR incomplete, semantic stages skipped', {
        contentId: content.id,
        traceId: ctx.traceId,
        provider: asrProvider,
        reason: ctx.degraded.asrReason,
        retainedSegments: alignedSegments.length,
      });
    }
    await replaceVideoArtifacts(
      content.id,
      visual.blocks,
      alignedSegments,
      visual.complete,
    );

    taskLogger.info('light-filter: video processed', {
      contentId: content.id,
      traceId: ctx.traceId,
      frames: visual.frameCount,
      kept: visual.keptFrameCount,
      invalidSkipped: visual.invalidSkipped,
      ocrFrames: visual.ocrFrames,
      textBlocks: visual.blocks.length,
      visualComplete: visual.complete,
      asrAvailable,
      transcriptSegments: alignedSegments.length,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await materialized.cleanup();
  }
}

/** 仅修复已完成视频的视觉依据；不抽音轨、不调用 ASR，也不重置知识点/闪卡/笔记。 */
export async function refreshVideoVisualEvidence(
  contentId: string,
  traceId: string,
): Promise<{ updated: boolean; textBlocks: number; visualComplete: boolean }> {
  const content = await prisma.learningContent.findUnique({ where: { id: contentId } });
  if (!content || content.contentType !== ContentType.VIDEO || content.understandingStatus !== 'COMPLETED') {
    throw new Error('仅能修复已完成理解的视频内容');
  }
  const [first, last] = await Promise.all([
    prisma.transcriptSegment.findFirst({ where: { contentId }, orderBy: { seq: 'asc' } }),
    prisma.transcriptSegment.findFirst({ where: { contentId }, orderBy: { seq: 'desc' } }),
  ]);
  if (!first || !last || first.text.includes('【mock 转写】') || last.text.includes('【mock 转写】') ||
    (content.durationSec !== null && last.endMs < (content.durationSec - 10) * 1_000)) {
    throw new Error('现有转写未覆盖视频末端，不能执行视觉单独修复');
  }
  if (!(await isFfmpegAvailable())) throw new Error('FFmpeg 不可用，无法刷新视频画面');

  const materialized = await materializeObject(getStorage(), content.storageKey);
  const workDir = path.join(tmpdir(), `slp-visual-refresh-${randomUUID()}`);
  try {
    const ctx: PipelineStageContext = { contentId, traceId, degraded: { infer: false, asr: false } };
    const visual = await collectVideoFrameBlocks(content, materialized.filePath, workDir, ctx);
    if (!visual.complete || visual.blocks.length === 0) {
      return { updated: false, textBlocks: visual.blocks.length, visualComplete: visual.complete };
    }
    await replaceVideoFrameBlocks(contentId, visual.blocks);
    return { updated: true, textBlocks: visual.blocks.length, visualComplete: true };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await materialized.cleanup();
  }
}

export async function lightFilterStage(ctx: PipelineStageContext): Promise<void> {
  const content = await prisma.learningContent.findUnique({ where: { id: ctx.contentId } });
  if (!content) {
    throw new Error(`content not found: ${ctx.contentId}`);
  }

  if (content.contentType === ContentType.VIDEO) {
    await runVideoLightFilter(content, ctx);
    return;
  }

  if (IMAGE_FORMATS.has(content.format)) {
    await runImageLightFilter(content, ctx);
    return;
  }

  if (content.format === 'PDF') {
    await runScannedPdfLightFilter(content, ctx);
    return;
  }

  // Markdown/TXT 文本层已由内容解析 worker 写入，无需视觉通道。
  taskLogger.warn('light-filter: document format not yet supported, skipped', {
    contentId: content.id,
    format: content.format,
  });
}

/** 注册阶段 A 处理器（由 registerAllProcessors 调用） */
export function registerLightFilterStage(): void {
  registerPipelineStage('light-filter', lightFilterStage);
}
