import { ContentType } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import {
  isProgressInRange,
  loadProgress,
  progressRequestSchema,
  refToResult,
  requestToRef,
  saveProgress,
  type ProgressRef,
} from '@/lib/domain/progress';
import { prisma } from '@/lib/prisma';

/**
 * 学习进度记忆（tasks.md §4.3）
 * ------------------------------------------------------------
 * PUT /api/contents/:id/progress —— 幂等上报（Redis TTL + 异步刷库）
 * GET /api/contents/:id/progress —— 读取上次进度与 lastStudiedAt
 * 异常映射：CONTENT_NOT_FOUND(404) / REF_OUT_OF_RANGE(400)
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

function contentTypeOf(contentType: ContentType): 'video' | 'document' {
  return contentType === ContentType.VIDEO ? 'video' : 'document';
}

export const PUT = withAuth<{ params: { id: string } }>(async (request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const parsed = progressRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const expectedType = contentTypeOf(content.contentType);
  if (parsed.data.contentType !== expectedType) {
    return fail(ErrorCode.REF_OUT_OF_RANGE, '进度类型与内容类型不一致', HttpStatus.BAD_REQUEST, {
      expectedType,
    });
  }

  const ref: ProgressRef = requestToRef(parsed.data);
  if (!isProgressInRange(ref, { durationSec: content.durationSec, pageCount: content.pageCount })) {
    return fail(ErrorCode.REF_OUT_OF_RANGE, '进度超出内容范围', HttpStatus.BAD_REQUEST, { ref });
  }

  const snapshot = await saveProgress(user.id, params.id, ref);
  return ok(refToResult(snapshot.ref, snapshot.lastStudiedAt), '进度已保存');
});

export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const snapshot = await loadProgress(user.id, params.id);
  if (snapshot) {
    return ok(refToResult(snapshot.ref, snapshot.lastStudiedAt));
  }

  const defaultRef: ProgressRef =
    content.contentType === ContentType.VIDEO
      ? { type: 'video', positionSec: 0 }
      : { type: 'document', page: 1, scrollRatio: 0 };
  return ok(refToResult(defaultRef, null));
});
