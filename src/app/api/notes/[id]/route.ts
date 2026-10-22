import { ContentType, type Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { contentRefSchema, isRefInRange, refTypeMatches } from '@/lib/domain/content-ref';
import { toNoteItem } from '@/lib/domain/note-mapper';
import { prisma } from '@/lib/prisma';

/**
 * 实时笔记：更新（乐观锁）/ 删除（tasks.md §4.2）
 * ------------------------------------------------------------
 * PATCH  /api/notes/:id —— 携带 expectedVersion，冲突时后写覆盖并返回 isOverwritten=true
 * DELETE /api/notes/:id —— 仅所有者可删
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

const patchSchema = z
  .object({
    content: z.string().max(5000, '笔记最多 5000 字').optional(),
    ref: contentRefSchema.optional(),
    expectedVersion: z.number().int().min(1),
  })
  .refine((v) => v.content !== undefined || v.ref !== undefined, {
    message: '至少提供一个待更新字段',
  });

export const PATCH = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }) => {
  const note = await prisma.note.findUnique({ where: { id: params.id } });
  if (!note) {
    return fail(ErrorCode.NOTE_NOT_FOUND, '笔记不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(note.ownerId, user);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const { content, ref, expectedVersion } = parsed.data;

  if (content !== undefined && content.trim().length === 0) {
    return fail(ErrorCode.NOTE_EMPTY, '笔记内容不能为空', HttpStatus.BAD_REQUEST);
  }

  if (ref !== undefined) {
    const lesson = await prisma.learningContent.findUnique({ where: { id: note.contentId } });
    if (!lesson) {
      return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
    }
    const type = lesson.contentType === ContentType.VIDEO ? 'video' : 'document';
    if (
      !refTypeMatches(ref, type) ||
      !isRefInRange(ref, { durationSec: lesson.durationSec, pageCount: lesson.pageCount, format: lesson.format, paragraphCount: (lesson.bookState as { unitCount?: number } | null)?.unitCount })
    ) {
      return fail(ErrorCode.REF_OUT_OF_RANGE, '笔记定位超出内容范围', HttpStatus.BAD_REQUEST, {
        ref,
      });
    }
  }

  // 乐观锁：冲突时"后写覆盖"，以本次内容为准并递增版本
  const isOverwritten = expectedVersion !== note.version;

  const updated = await prisma.note.update({
    where: { id: params.id },
    data: {
      ...(content !== undefined ? { content: content.trim() } : {}),
      ...(ref !== undefined ? { ref: ref as Prisma.InputJsonValue } : {}),
      version: note.version + 1,
    },
  });

  return ok({ ...toNoteItem(updated), isOverwritten }, '笔记已更新');
});

export const DELETE = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const note = await prisma.note.findUnique({ where: { id: params.id } });
  if (!note) {
    return fail(ErrorCode.NOTE_NOT_FOUND, '笔记不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(note.ownerId, user);

  await prisma.note.delete({ where: { id: params.id } });
  return ok({ noteId: params.id, deleted: true }, '笔记已删除');
});
