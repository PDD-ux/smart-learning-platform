import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { fail, ok, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { planDto } from '@/lib/domain/study-plan';

export const PATCH = withAuth<{ params: { id: string } }>(async (request, { user, params }) => {
  const parsed = z.object({ completed: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '完成状态无效', HttpStatus.BAD_REQUEST);
  const changed = await prisma.learningPlan.updateMany({ where: { id: params.id, ownerId: user.id }, data: { completedAt: parsed.data.completed ? new Date() : null } });
  if (!changed.count) return fail(ErrorCode.NOT_FOUND, '计划不存在', HttpStatus.NOT_FOUND);
  const plan = await prisma.learningPlan.findFirst({ where: { id: params.id, ownerId: user.id }, include: { content: { select: { title: true } } } });
  if (!plan) return fail(ErrorCode.NOT_FOUND, '计划不存在', HttpStatus.NOT_FOUND);
  return ok(planDto(plan));
});

export const DELETE = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const deleted = await prisma.learningPlan.deleteMany({ where: { id: params.id, ownerId: user.id } });
  if (!deleted.count) return fail(ErrorCode.NOT_FOUND, '计划不存在', HttpStatus.NOT_FOUND);
  return ok({ planId: params.id, deleted: true });
});
