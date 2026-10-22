import { z } from 'zod';

/**
 * 统一定位模型 ContentRef（design.md §2.1.3 / tasks.md 2.1）
 * ------------------------------------------------------------
 * video: timestampSec | document: page + blockIndex
 * 供笔记、文本块、知识点、进度等模块复用；zod schema 校验合法区间。
 */

export const videoRefSchema = z.object({
  type: z.literal('video'),
  timestampSec: z.number().int().min(0),
});

export const documentRefSchema = z.object({
  type: z.literal('document'),
  page: z.number().int().min(1),
  blockIndex: z.number().int().min(0).optional(),
});

export const contentRefSchema = z.discriminatedUnion('type', [
  videoRefSchema,
  documentRefSchema,
]);

export type VideoRef = z.infer<typeof videoRefSchema>;
export type DocumentRef = z.infer<typeof documentRefSchema>;
export type ContentRef = z.infer<typeof contentRefSchema>;

/** 校验定位是否在合法区间内（视频在时长内、文档在页数内） */
export function isRefInRange(
  ref: ContentRef,
  bounds: { durationSec?: number | null; pageCount?: number | null; format?: string; paragraphCount?: number },
): boolean {
  if (ref.type === 'video') {
    if (bounds.durationSec == null) return false;
    return ref.timestampSec <= bounds.durationSec;
  }
  if (ref.type === 'document') {
    if (bounds.format === 'EPUB') return ref.page === 1 && ref.blockIndex !== undefined && ref.blockIndex < (bounds.paragraphCount ?? 0);
    if (bounds.pageCount == null) return false;
    return ref.page >= 1 && ref.page <= bounds.pageCount;
  }
  return false;
}

/** ContentRef 排序键：视频按时间戳、文档按页码 */
export function refSortKey(ref: ContentRef): number {
  return ref.type === 'video' ? ref.timestampSec : ref.page;
}

export function isVideoRef(ref: ContentRef): ref is VideoRef {
  return ref.type === 'video';
}

export function isDocumentRef(ref: ContentRef): ref is DocumentRef {
  return ref.type === 'document';
}

/** 定位类型是否与内容类型一致（视频内容只能挂视频定位） */
export function refTypeMatches(ref: ContentRef, contentType: 'video' | 'document'): boolean {
  return ref.type === contentType;
}