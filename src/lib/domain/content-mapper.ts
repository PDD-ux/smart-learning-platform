import { ContentType, type LearningContent } from '@prisma/client';

import { getStorage } from '@/lib/storage';
import {
  contentStatusLabel,
  understandStatusLabel,
  type ContentStatusLabel,
  type UnderstandStatusLabel,
} from './content-status';

/**
 * 内容摘要映射（tasks.md §3.2）
 * ------------------------------------------------------------
 * 将 Prisma LearningContent 行映射为 API 契约 ContentSummary
 * （spec/03-ARCHITECTURE.md §2.2.2）：枚举转中文/小写标签、BigInt 不暴露。
 */

export type ContentSummary = {
  /** EPUB has stable paragraph positions, not fixed pages. */
  format?: 'EPUB';
  contentId: string;
  contentType: 'video' | 'document';
  title: string;
  description: string | null;
  durationSec: number | null;
  pageCount: number | null;
  status: ContentStatusLabel;
  coverUrl: string | null;
  understandingStatus: UnderstandStatusLabel;
  createdAt: string;
  updatedAt: string;
};

export function toContentSummary(
  content: LearningContent,
  coverUrl: string | null = null,
): ContentSummary {
  return {
    contentId: content.id,
    ...(content.format === 'EPUB' ? { format: 'EPUB' as const } : {}),
    contentType: content.contentType === ContentType.VIDEO ? 'video' : 'document',
    title: content.title,
    description: content.description,
    durationSec: content.durationSec,
    pageCount: content.pageCount,
    status: contentStatusLabel(content.status),
    coverUrl,
    understandingStatus: understandStatusLabel(content.understandingStatus),
    createdAt: content.createdAt.toISOString(),
    updatedAt: content.updatedAt.toISOString(),
  };
}

/**
 * 将库中 `coverUrl`（存的是对象存储 storageKey）签发为可访问的读取地址。
 * 存 key 而非 URL，避免预签名地址过期后封面失效；签发失败降级为 null。
 */
export async function resolveCoverUrl(coverKey: string | null): Promise<string | null> {
  if (!coverKey) return null;
  try {
    return (await getStorage().createReadUrl(coverKey)).url;
  } catch {
    return null;
  }
}

/** 读取内容时使用：自动把封面 storageKey 签名为读取地址 */
export async function toContentSummaryAsync(content: LearningContent): Promise<ContentSummary> {
  return toContentSummary(content, await resolveCoverUrl(content.coverUrl));
}
