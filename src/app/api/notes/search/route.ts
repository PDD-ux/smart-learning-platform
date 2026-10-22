import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { toNoteItem } from '@/lib/domain/note-mapper';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = withAuth(async (request: NextRequest, { user }): Promise<Response> => {
  const parsed = querySchema.safeParse({
    q: new URL(request.url).searchParams.get('q') ?? '',
    page: new URL(request.url).searchParams.get('page') ?? undefined,
    pageSize: new URL(request.url).searchParams.get('pageSize') ?? undefined,
  });

  if (!parsed.success) {
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (query.length === 0) {
      return fail(ErrorCode.QUERY_TOO_SHORT, '搜索内容至少需要 1 个字符', HttpStatus.BAD_REQUEST);
    }
    return fail(ErrorCode.VALIDATION_FAILED, '分页参数或搜索内容无效', HttpStatus.BAD_REQUEST, parsed.error.flatten().fieldErrors);
  }

  const { q, page, pageSize } = parsed.data;
  const where = { ownerId: user.id, content: { contains: q, mode: 'insensitive' as const } };
  const [total, notes] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { lesson: { select: { title: true } } },
    }),
  ]);

  const items = notes.map((note) => ({
    noteId: note.id,
    content: note.content,
    ref: toNoteItem(note).ref,
    contentId: note.contentId,
    contentTitle: note.lesson.title,
  }));

  return ok({ page, pageSize, total, items });
});
