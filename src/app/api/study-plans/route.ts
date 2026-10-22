import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { fail, ok, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { createPlanSchema, planDto } from '@/lib/domain/study-plan';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  due: z.enum(['true', 'false']).optional(),
});

export const GET = withAuth(async (request, { user }) => {
  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(search));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '计划查询参数无效', HttpStatus.BAD_REQUEST);
  const { page, pageSize, due } = parsed.data;
  const now = new Date();
  const where = due === 'true'
    ? { ownerId: user.id, completedAt: null, remindAt: { lte: now } }
    : { ownerId: user.id };
  const [total, items, totalPlans, completedPlans] = await prisma.$transaction([
    prisma.learningPlan.count({ where }),
    prisma.learningPlan.findMany({ where, include: { content: { select: { title: true } } }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.learningPlan.count({ where: { ownerId: user.id } }),
    prisma.learningPlan.count({ where: { ownerId: user.id, completedAt: { not: null } } }),
  ]);
  return ok({ page, pageSize, total, items: items.map((plan) => planDto(plan, now)), summary: { totalPlans, completedPlans } });
});

export const POST = withAuth(async (request, { user }) => {
  const parsed = createPlanSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '请检查计划标题、时长及时间', HttpStatus.BAD_REQUEST, parsed.error.flatten().fieldErrors);
  const content = await prisma.learningContent.findUnique({ where: { id: parsed.data.contentId }, select: { ownerId: true } });
  if (!content) return fail(ErrorCode.CONTENT_NOT_FOUND, '资料不存在', HttpStatus.NOT_FOUND);
  if (content.ownerId !== user.id) return fail(ErrorCode.FORBIDDEN, '只能为自己的资料创建计划', HttpStatus.FORBIDDEN);
  const plan = await prisma.learningPlan.create({
    data: { ...parsed.data, ownerId: user.id, scheduledAt: new Date(parsed.data.scheduledAt), remindAt: new Date(parsed.data.remindAt) },
    include: { content: { select: { title: true } } },
  });
  return ok(planDto(plan), '计划已创建');
});
