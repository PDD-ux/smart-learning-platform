import { prisma } from '@/lib/prisma';
import type { JobType } from '@prisma/client';

/**
 * AsyncJob 任务框架（tasks.md 2.3）
 * ------------------------------------------------------------
 * 任务记录 CRUD 与状态机（pending/running/succeeded/failed）、
 * attempts 重试计数、errorReason、关联 contentId/traceId/stage/durationMs。
 */

export type AsyncJobInput = {
  jobType: JobType;
  contentId: string;
  traceId: string;
};

export async function createJob(input: AsyncJobInput) {
  return prisma.asyncJob.create({
    data: {
      jobType: input.jobType,
      contentId: input.contentId,
      traceId: input.traceId,
      state: 'PENDING',
      attempts: 0,
    },
  });
}

/**
 * 原子认领任务：仅当任务仍处于 PENDING 时才将其置为 RUNNING 并累加 attempts。
 * 已 RUNNING / SUCCEEDED / FAILED 的任务不会重复认领，避免并发或重试导致 attempts 翻倍、
 * 或把已完成的任务重新拉起来跑。返回是否真正发生了认领（count > 0）。
 */
export async function startJob(jobId: string): Promise<boolean> {
  const result = await prisma.asyncJob.updateMany({
    where: { id: jobId, state: 'PENDING' },
    data: { state: 'RUNNING', attempts: { increment: 1 }, errorReason: null },
  });
  return result.count > 0;
}

/** Release a failed attempt before the queue schedules its next retry. */
export async function retryJob(jobId: string, reason: string): Promise<void> {
  await prisma.asyncJob.updateMany({
    where: { id: jobId, state: 'RUNNING' },
    data: { state: 'PENDING', errorReason: reason.slice(0, 500) },
  });
}

export async function succeedJob(jobId: string, durationMs: number) {
  return prisma.asyncJob.update({
    where: { id: jobId },
    data: { state: 'SUCCEEDED', durationMs },
  });
}

export async function failJob(jobId: string, errorReason: string, durationMs: number) {
  return prisma.asyncJob.update({
    where: { id: jobId },
    data: { state: 'FAILED', errorReason: errorReason.slice(0, 500), durationMs },
  });
}

export async function updateJobStage(jobId: string, stage: string) {
  return prisma.asyncJob.update({ where: { id: jobId }, data: { stage } });
}

export async function recordJobErrorReason(jobId: string, errorReason: string) {
  return prisma.asyncJob.update({
    where: { id: jobId },
    data: { errorReason: errorReason.slice(0, 500) },
  });
}

export async function getLatestJob(contentId: string, jobType: JobType) {
  return prisma.asyncJob.findFirst({
    where: { contentId, jobType },
    orderBy: { createdAt: 'desc' },
  });
}
