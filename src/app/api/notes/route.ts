import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { toNoteItem } from '@/lib/domain/note-mapper';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  contentId: z.string().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = withAuth(async (request: NextRequest, { user }): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const keys = ['q', 'contentId', 'page', 'pageSize'] as const;
  if (keys.some((key): boolean => params.getAll(key).length > 1)) return fail(ErrorCode.VALIDATION_FAILED, '筛选参数不能重复', HttpStatus.BAD_REQUEST);
  const parsed = querySchema.safeParse(Object.fromEntries(keys.map((key): [string, string | undefined] => [key, params.get(key) ?? undefined])));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '笔记筛选或分页参数无效', HttpStatus.BAD_REQUEST);
  const { q, contentId, page, pageSize } = parsed.data;
  if (contentId && !await prisma.learningContent.findFirst({ where: { id: contentId, ownerId: user.id }, select: { id: true } })) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '资料不存在', HttpStatus.NOT_FOUND);
  }
  const where = { ownerId: user.id, lesson: { ownerId: user.id }, ...(contentId ? { contentId } : {}), ...(q ? { content: { contains: q, mode: 'insensitive' as const } } : {}) };
  const [total, notes] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, include: { lesson: { select: { title: true } } } }),
  ]);
  return ok({ page, pageSize, total, items: notes.map((note) => ({ ...toNoteItem(note), contentTitle: note.lesson.title })) });
});
