import {privateResponse} from '@/lib/api/private-response';
import {publicPasteSource} from '@/lib/text-imports/contracts';
import type {BookState} from '@/lib/books/contracts';
import { ContentStatus, ContentType } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { prisma } from '@/lib/prisma';
import { getStorage, StorageError } from '@/lib/storage';

/**
 * 浏览资源下发（tasks.md §4.1）
 * ------------------------------------------------------------
 * GET /api/contents/:id/resource
 *   - 归属校验；非 `已就绪` 内容禁止访问浏览入口（CONTENT_NOT_READY）
 *   - 返回预签名读取地址：视频支持 HTTP Range 断点续播；文档用于阅读/图片预览
 *
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

export const GET = privateResponse(withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  if (content.status !== ContentStatus.READY) {
    return fail(
      ErrorCode.CONTENT_NOT_READY,
      '内容尚未就绪，暂不可浏览',
      HttpStatus.CONFLICT,
    );
  }

  let url: string;
  let expiresInSec: number;
  try {
    const storage = getStorage();
    const presigned = await storage.createReadUrl(content.storageKey);
    const localUrl = storage.driver === 'local' ? new URL(presigned.url) : null;
    url = localUrl ? `${localUrl.pathname}${localUrl.search}` : presigned.url;
    expiresInSec = presigned.expiresInSec;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[content-resource] storage unavailable', {
      contentId: content.id,
      code: err instanceof StorageError ? err.code : 'UNKNOWN',
    });
    return fail(
      ErrorCode.STORAGE_UNAVAILABLE,
      '存储服务暂时不可用，请稍后重试',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  return ok(
    {
      contentId: content.id,
      contentType: content.contentType === ContentType.VIDEO ? 'video' : 'document',
      url,
      expiresInSec,
      durationSec: content.durationSec,
      pageCount: content.pageCount,
      format: content.format,
      ...((content.bookState as unknown as BookState|null)?.pastedSource ? {pasteSource:publicPasteSource((content.bookState as unknown as BookState).pastedSource!)} : {}),
      ...(content.urlSource ? {source:content.urlSource} : {}),
    },
    '资源地址已签发',
  );
}));
