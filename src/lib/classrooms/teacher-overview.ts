import type { Prisma, PrismaClient } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';
import { prisma } from '@/lib/prisma';

type Tx = Prisma.TransactionClient;

export type TeacherTaskSummary = {
  id: string;
  classroomId: string;
  classroomTitle: string;
  title: string;
  state: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'WITHDRAWN';
  dueAt: string | null;
  updatedAt: string;
  pendingReviews: number;
};

export type TeacherOverview = {
  generatedAt: string;
  summary: { classroomCount: number; activeClassroomCount: number; assignmentCount: number; pendingReviewCount: number };
  classrooms: Array<{ id: string; title: string; state: 'ACTIVE' | 'ARCHIVED'; activeMembers: number; assignmentCount: number; pendingReviewCount: number }>;
  reviewQueue: TeacherTaskSummary[];
  recentAssignments: TeacherTaskSummary[];
};

function asTaskState(value: string): TeacherTaskSummary['state'] {
  if (value === 'DRAFT' || value === 'PUBLISHED' || value === 'CLOSED' || value === 'WITHDRAWN') return value;
  throw new ApiError(ErrorCode.INTERNAL, '班级任务状态暂不可用');
}

async function loadOverview(tx: Tx, actorId: string): Promise<TeacherOverview> {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor) throw new ApiError(ErrorCode.UNAUTHENTICATED, '账号已失效，请重新登录');
  if (actor.role !== 'teacher') throw new ApiError(ErrorCode.FORBIDDEN, '仅教师可以查看教学总览');

  const classrooms = await tx.classroom.findMany({
    where: { responsibleId: actorId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: { id: true, title: true, state: true },
  });
  const classroomIds = classrooms.map((room) => room.id);
  const [memberCounts, assignments] = await Promise.all([
    tx.classMember.groupBy({ by: ['classroomId'], where: { classroomId: { in: classroomIds }, state: 'ACTIVE' }, _count: { _all: true } }),
    tx.classAssignment.findMany({
      where: { classroomId: { in: classroomIds } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, classroomId: true, title: true, state: true, dueAt: true, updatedAt: true },
    }),
  ]);

  const assignmentIds = assignments.map((task) => task.id);
  const pendingSubmissions = assignmentIds.length === 0 ? [] : await tx.assignmentSubmission.findMany({
    where: { assignmentId: { in: assignmentIds }, state: 'SUBMITTED' },
    select: { assignmentId: true },
  });
  const rooms = new Map(classrooms.map((room) => [room.id, room]));
  const taskClass = new Map(assignments.map((task) => [task.id, task.classroomId]));
  const memberCountsByClass = new Map(memberCounts.map((row) => [row.classroomId, row._count._all]));
  const pendingByTask = new Map<string, number>();
  const pendingByClass = new Map<string, number>();
  for (const submission of pendingSubmissions) {
    pendingByTask.set(submission.assignmentId, (pendingByTask.get(submission.assignmentId) ?? 0) + 1);
    const classroomId = taskClass.get(submission.assignmentId);
    if (classroomId) pendingByClass.set(classroomId, (pendingByClass.get(classroomId) ?? 0) + 1);
  }

  const taskSummaries: TeacherTaskSummary[] = assignments.map((task) => ({
    id: task.id,
    classroomId: task.classroomId,
    classroomTitle: rooms.get(task.classroomId)?.title ?? '班级不可用',
    title: task.title,
    state: asTaskState(task.state),
    dueAt: task.dueAt?.toISOString() ?? null,
    updatedAt: task.updatedAt.toISOString(),
    pendingReviews: pendingByTask.get(task.id) ?? 0,
  }));
  const reviewQueue = taskSummaries.filter((task) => task.pendingReviews > 0)
    .sort((left, right) => right.pendingReviews - left.pendingReviews || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 50);
  const recentAssignments = taskSummaries.slice(0, 12);
  const assignmentCountByClass = new Map<string, number>();
  for (const task of assignments) assignmentCountByClass.set(task.classroomId, (assignmentCountByClass.get(task.classroomId) ?? 0) + 1);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      classroomCount: classrooms.length,
      activeClassroomCount: classrooms.filter((room) => room.state === 'ACTIVE').length,
      assignmentCount: assignments.length,
      pendingReviewCount: pendingSubmissions.length,
    },
    classrooms: classrooms.map((room) => ({
      id: room.id,
      title: room.title,
      state: room.state,
      activeMembers: memberCountsByClass.get(room.id) ?? 0,
      assignmentCount: assignmentCountByClass.get(room.id) ?? 0,
      pendingReviewCount: pendingByClass.get(room.id) ?? 0,
    })),
    reviewQueue,
    recentAssignments,
  };
}

export async function teacherOverview(actorId: string, db: PrismaClient = prisma): Promise<TeacherOverview> {
  return db.$transaction((tx) => loadOverview(tx, actorId), { maxWait: 5000, timeout: 10000 });
}
