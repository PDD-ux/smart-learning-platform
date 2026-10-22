import { ExerciseType, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { fail, ok, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

const types = { single_choice: ExerciseType.SINGLE_CHOICE, true_false: ExerciseType.TRUE_FALSE, short_answer: ExerciseType.SHORT_ANSWER };
const labels = { SINGLE_CHOICE: 'single_choice', TRUE_FALSE: 'true_false', SHORT_ANSWER: 'short_answer' } as const;
const querySchema = z.object({
  contentId: z.string().min(1).optional(),
  pointId: z.string().min(1).optional(),
  type: z.enum(['single_choice', 'true_false', 'short_answer']).optional(),
  status: z.enum(['all', 'unanswered', 'wrong']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const GET = withAuth(async (request, { user }) => {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '题库查询参数无效', HttpStatus.BAD_REQUEST);
  const { contentId, pointId, type, status, page, pageSize } = parsed.data;
  const where: Prisma.ExerciseWhereInput = { content: { ownerId: user.id }, point: { ownerId: user.id } };
  if (contentId) where.contentId = contentId;
  if (pointId) where.pointId = pointId;
  if (type) where.type = types[type];
  if (status === 'unanswered') where.records = { none: { learnerId: user.id } };
  if (status === 'wrong') where.records = { some: { learnerId: user.id, correct: false } };
  const [total, exercises] = await prisma.$transaction([
    prisma.exercise.count({ where }),
    prisma.exercise.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      include: {
        content: { select: { title: true } }, point: { select: { title: true } },
        records: { where: { learnerId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
      },
    }),
  ]);
  return ok({ page, pageSize, total, items: exercises.map((exercise, index) => {
    const record = exercise.records[0];
    return {
      exerciseId: exercise.id, contentId: exercise.contentId, contentTitle: exercise.content.title,
      pointId: exercise.pointId, pointTitle: exercise.point.title,
      type: labels[exercise.type], question: exercise.question, options: exercise.options, index,
      latestRecord: record ? { userAnswer: record.userAnswer, correct: record.correct, createdAt: record.createdAt.toISOString(), correctAnswer: exercise.correctAnswer, explanation: exercise.explanation } : null,
    };
  }) });
});
