import { JobType, Prisma } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';
import { taskLogger } from '@/lib/jobs/task-logger';
import { prisma } from '@/lib/prisma';
import { enqueue, QueueName, type JobPayload } from '@/lib/queue';

const MESSAGE = '任务队列暂不可用，源文件已保留，请稍后重试。';

export class QueueDispatchError extends ApiError {
  constructor() {
    super(ErrorCode.QUEUE_UNAVAILABLE, MESSAGE);
    this.name = 'QueueDispatchError';
  }
}

/** Compensate only an unclaimed delivery; a lost queue acknowledgement is not proof of failure. */
export async function dispatchPendingJob(name: typeof QueueName.CONTENT_PARSE | typeof QueueName.UNDERSTANDING, payload: JobPayload & { asyncJobId: string }): Promise<void> {
  try {
    await enqueue(name, payload);
  } catch {
    const cancelled = await prisma.$transaction(async (tx): Promise<boolean> => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "LearningContent" WHERE id = ${payload.contentId} FOR UPDATE`);
      const jobType = name === QueueName.CONTENT_PARSE ? JobType.CONTENT_PARSE : JobType.UNDERSTANDING;
      const latest = await tx.asyncJob.findFirst({
        where: { contentId: payload.contentId, jobType },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      const changed = await tx.asyncJob.updateMany({
        where: { id: payload.asyncJobId, contentId: payload.contentId, jobType, state: 'PENDING' },
        data: { state: 'FAILED', errorReason: MESSAGE },
      });
      if (changed.count && latest?.id === payload.asyncJobId) {
        const update: Prisma.LearningContentUpdateManyArgs = name === QueueName.CONTENT_PARSE ? {
          where: { id: payload.contentId, status: 'PARSING' },
          data: { status: 'FAILED', failReason: MESSAGE },
        } : {
          where: { id: payload.contentId, understandingStatus: 'RUNNING' },
          data: { understandingStatus: 'FAILED' },
        };
        await tx.learningContent.updateMany(update);
      }
      return changed.count > 0;
    });
    taskLogger.warn('queue delivery acknowledgement failed', { queue: name, jobId: payload.asyncJobId, cancelled });
    if (cancelled) throw new QueueDispatchError();
  }
}
