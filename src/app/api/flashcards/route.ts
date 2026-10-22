import { CardStatus, type Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { toFlashcardItem } from '@/lib/domain/flashcard-mapper';
import { prisma } from '@/lib/prisma';

/**
 * 闪卡列表（tasks.md §7.2）
 * ------------------------------------------------------------
 * GET /api/flashcards?contentId=&due=true&page=&pageSize=
 * 仅返回当前学习者自己的闪卡；due=true 时只返回已到期且尚未毕业的卡片。
 */

const querySchema = z.object({
  contentId: z.string().min(1).optional(),
  due: z.union([z.enum(['true', 'false']), z.undefined()]).transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const GET = withAuth(async (request: NextRequest, { user }) => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    contentId: searchParams.get('contentId') ?? undefined,
    due: searchParams.get('due') ?? undefined,
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
  });
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '查询参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const { contentId, due, page, pageSize } = parsed.data;
  const where: Prisma.FlashcardWhereInput = { ownerId: user.id, content: { ownerId: user.id } };
  if (contentId) where.contentId = contentId;
  if (due) {
    where.status = { in: [CardStatus.NEW, CardStatus.LEARNING, CardStatus.REVIEW] };
    where.nextReviewAt = { lte: new Date() };
  }

  const [total, cards] = await prisma.$transaction([
    prisma.flashcard.count({ where }),
    prisma.flashcard.findMany({
      where,
      orderBy: [{ nextReviewAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { content: { select: { title: true } }, point: { select: { title: true, ownerId: true, contentId: true } } },
    }),
  ]);

  return ok({
    page,
    pageSize,
    total,
    items: cards.map(toFlashcardItem),
  });
});
