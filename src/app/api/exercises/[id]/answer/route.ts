import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { recalculateMastery } from '@/lib/domain/mastery';
import { prisma } from '@/lib/prisma';

/**
 * 练习作答（tasks.md §7.4）
 * ------------------------------------------------------------
 * POST /api/exercises/:id/answer
 * 判分、写入 ExerciseRecord，并在同一事务内重算关联知识点掌握度。
 */

const bodySchema = z.object({
  userAnswer: z.string().max(2000),
});

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export const POST = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }) => {
  const exercise = await prisma.exercise.findUnique({
    where: { id: params.id },
    include: { point: { select: { ownerId: true } } },
  });
  if (!exercise) {
    return fail(ErrorCode.EXERCISE_NOT_FOUND, '练习不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(exercise.point.ownerId, user);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.userAnswer.trim()) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '作答内容不能为空',
      HttpStatus.BAD_REQUEST,
      parsed.success ? undefined : parsed.error.flatten().fieldErrors,
    );
  }

  const normalizeTypedAnswer = (value: string): string => {
    const normalized = normalizeAnswer(value);
    if (exercise.type === 'TRUE_FALSE') {
      if (['正确', '对', '是', 'true', 't'].includes(normalized)) return 'true';
      if (['错误', '错', '否', 'false', 'f'].includes(normalized)) return 'false';
    }
    if (exercise.type === 'SINGLE_CHOICE') {
      const index = exercise.options.findIndex((option) => normalizeAnswer(option) === normalized);
      if (index >= 0) return String.fromCharCode(97 + index);
      const label = normalized.match(/^([a-f])(?:[.、．:：)）\s]|$)/);
      if (label) return label[1];
    }
    return normalized;
  };
  const correct = normalizeTypedAnswer(parsed.data.userAnswer) === normalizeTypedAnswer(exercise.correctAnswer);
  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.exerciseRecord.create({
      data: {
        exerciseId: exercise.id,
        learnerId: user.id,
        userAnswer: parsed.data.userAnswer.trim(),
        correct,
        masteryDelta: 0,
      },
    });
    const mastery = await recalculateMastery(tx, user.id, exercise.pointId);
    const updatedRecord = await tx.exerciseRecord.update({
      where: { id: record.id },
      data: { masteryDelta: mastery.masteryDelta },
    });
    return { mastery, updatedRecord };
  });

  return ok({
    exerciseId: exercise.id,
    correct,
    correctAnswer: exercise.correctAnswer,
    explanation: exercise.explanation,
    masteryDelta: result.mastery.masteryDelta,
  }, '已完成判分');
});
