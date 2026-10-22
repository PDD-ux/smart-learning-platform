import { TextSource, type KnowledgePoint, type TextBlock, type TranscriptSegment } from '@prisma/client';
import { z } from 'zod';

import { contentRefSchema, type ContentRef } from './content-ref';

/**
 * 理解产物 DTO 映射（tasks.md §6.5）
 * 对齐 spec/03-ARCHITECTURE.md §2.2.2-(3)。
 */

export type TranscriptSegmentDto = {
  segmentId: string;
  seq: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type TextBlockSourceDto = 'pdf' | 'md' | 'ocr';

export type TextBlockDto = {
  blockId: string;
  ref: ContentRef;
  text: string;
  source: TextBlockSourceDto;
};

export type KnowledgePointDto = {
  pointId: string;
  title: string;
  summary: string;
  tags: string[];
  importance: number;
  refs: ContentRef[];
};

const refsSchema = z.array(contentRefSchema);

function mapTextBlockSource(source: TextSource): TextBlockSourceDto {
  if (source === TextSource.PDF) return 'pdf';
  if (source === TextSource.MD) return 'md';
  return 'ocr'; // OCR 与 FRAME 均归为 OCR 文本
}

export function toTranscriptSegmentDto(row: TranscriptSegment): TranscriptSegmentDto {
  return {
    segmentId: row.id,
    seq: row.seq,
    startMs: row.startMs,
    endMs: row.endMs,
    text: row.text,
  };
}

export function toTextBlockDto(row: TextBlock): TextBlockDto {
  return {
    blockId: row.id,
    ref: contentRefSchema.parse(row.ref),
    text: row.text,
    source: mapTextBlockSource(row.source),
  };
}

export function toKnowledgePointDto(row: KnowledgePoint): KnowledgePointDto {
  const parsed = refsSchema.safeParse(row.refs);
  return {
    pointId: row.id,
    title: row.title,
    summary: row.summary,
    tags: row.tags,
    importance: row.importance,
    refs: parsed.success ? parsed.data : [],
  };
}
