import { ContentType, type Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { toContentSummaryAsync } from '@/lib/domain/content-mapper';
import { prisma } from '@/lib/prisma';

/**
 * 内容列表（tasks.md §3.2）
 * ------------------------------------------------------------
 * GET /api/contents?type=video|document&page=&pageSize=
 *   - 仅返回当前学习者所属内容（权限隔离）
 *   - 统一分页结构 { page, pageSize, total, items }
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

const querySchema = z.object({
  type: z.enum(['video', 'document']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const GET = withAuth(async (request: NextRequest, { user }) => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    type: searchParams.get('type') ?? undefined,
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

  const { type, page, pageSize } = parsed.data;
  const where: Prisma.LearningContentWhereInput = { ownerId: user.id };
  if (type) {
    where.contentType = type === 'video' ? ContentType.VIDEO : ContentType.DOCUMENT;
  }

  const [total, items] = await prisma.$transaction([
    prisma.learningContent.count({ where }),
    prisma.learningContent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const summaries = await Promise.all(items.map(toContentSummaryAsync));
  return ok({ page, pageSize, total, items: summaries });
});
