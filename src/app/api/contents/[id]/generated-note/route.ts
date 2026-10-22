import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { generateStructuredNote } from '@/lib/domain/generated-note';
import { prisma } from '@/lib/prisma';

function toDto(note: { markdown: string; sourceCount: number; generatedAt: Date } | null): { markdown: string; sourceCount: number; generatedAt: string } | null {
  return note ? { markdown: note.markdown, sourceCount: note.sourceCount, generatedAt: note.generatedAt.toISOString() } : null;
}

export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id }, select: { ownerId: true } });
  if (!content) return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  assertOwnership(content.ownerId, user);
  const note = await prisma.generatedNote.findUnique({ where: { contentId: params.id } });
  return ok({ note: toDto(note) });
});

/** 按现有解析产物重新组织 AI 笔记；不会改动学习者的个人实时笔记。 */
export const POST = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id }, select: { ownerId: true } });
  if (!content) return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  assertOwnership(content.ownerId, user);
  await generateStructuredNote(params.id);
  const note = await prisma.generatedNote.findUnique({ where: { contentId: params.id } });
  return ok({ note: toDto(note) }, '已按当前解析结果重新整理笔记');
});
