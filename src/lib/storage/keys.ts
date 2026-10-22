import path from 'node:path';

import { DEFAULT_CONTENT_TYPE } from './config';

/** 由扩展名推断 MIME（本地驱动无法像 S3 那样持久化元数据） */
export function contentTypeFromKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  return map[ext] ?? DEFAULT_CONTENT_TYPE;
}

export function buildContentKey(contentId: string, fileName: string): string {
  const safeName = fileName.replace(/[\\/]/g, '_');
  return `contents/${contentId}/${safeName}`;
}

export function buildFrameKey(contentId: string, frameIndex: number, ext = 'jpg'): string {
  return `frames/${contentId}/${String(frameIndex).padStart(5, '0')}.${ext}`;
}

export function contentKeyPrefix(contentId: string): string {
  return `contents/${contentId}/`;
}

export function frameKeyPrefix(contentId: string): string {
  return `frames/${contentId}/`;
}

export function buildCoverKey(contentId: string, ext = 'jpg'): string {
  return `covers/${contentId}/cover.${ext}`;
}

export function coverKeyPrefix(contentId: string): string {
  return `covers/${contentId}/`;
}
