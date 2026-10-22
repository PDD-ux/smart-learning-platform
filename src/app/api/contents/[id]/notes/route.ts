import { ContentStatus, ContentType, type Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import {
  contentRefSchema,
  isRefInRange,
  refTypeMatches,
  type ContentRef,
} from '@/lib/domain/content-ref';
import { compareNotes, toNoteItem } from '@/lib/domain/note-mapper';
import { prisma } from '@/lib/prisma';

/**
 * 实时笔记：列表 / 创建（tasks.md §4.2）
 * ------------------------------------------------------------
 * GET  /api/contents/:id/notes —— 按定位升序返回笔记列表
 * POST /api/contents/:id/notes —— 校验正文与定位后创建
 * 异常映射：NOTE_EMPTY(400) / REF_OUT_OF_RANGE(400) / CONTENT_NOT_READY(409)
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

function contentTypeOf(contentType: ContentType): 'video' | 'document' {
  return contentType === ContentType.VIDEO ? 'video' : 'document';
}

const createSchema = z.object({
  content: z.string().max(5000, '笔记最多 5000 字'),
  ref: contentRefSchema,
});

export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const notes = await prisma.note.findMany({ where: { contentId: params.id } });
  const items = notes.map(toNoteItem).sort(compareNotes);
  return ok({ items });
});

export const POST = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  if (content.status !== ContentStatus.READY) {
    return fail(ErrorCode.CONTENT_NOT_READY, '内容尚未就绪，暂不可记笔记', HttpStatus.CONFLICT);
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const body = parsed.data.content.trim();
  if (body.length === 0) {
    return fail(ErrorCode.NOTE_EMPTY, '笔记内容不能为空', HttpStatus.BAD_REQUEST);
  }

  const ref: ContentRef = parsed.data.ref;
  if (
    !refTypeMatches(ref, contentTypeOf(content.contentType)) ||
    !isRefInRange(ref, { durationSec: content.durationSec, pageCount: content.pageCount, format: content.format, paragraphCount: (content.bookState as { unitCount?: number } | null)?.unitCount })
  ) {
    return fail(ErrorCode.REF_OUT_OF_RANGE, '笔记定位超出内容范围', HttpStatus.BAD_REQUEST, {
      ref,
    });
  }

  const note = await prisma.note.create({
    data: {
      ownerId: user.id,
      contentId: params.id,
      content: body,
      ref: ref as Prisma.InputJsonValue,
      version: 1,
    },
  });

  return ok(toNoteItem(note), '笔记已保存');
});
