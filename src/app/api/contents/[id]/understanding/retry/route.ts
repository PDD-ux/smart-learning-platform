import { ContentStatus, UnderstandStatus } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { enqueueUnderstanding } from '@/lib/jobs/pipeline/understanding-pipeline';
import { registerAllProcessors } from '@/lib/jobs/workers';
import { prisma } from '@/lib/prisma';

/**
 * 手动重试理解流水线（tasks.md §6.2）
 * ------------------------------------------------------------
 * POST /api/contents/:id/understanding/retry
 *   - 仅「已就绪」且理解任务为终态失败时可触发；
 *   - 重新入队 UnderstandingJob，重置为 `light-filter`。
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2-(3)。
 */

export const POST = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  if (content.status !== ContentStatus.READY) {
    return fail(ErrorCode.CONTENT_NOT_READY, '内容尚未就绪，暂不可重试理解', HttpStatus.CONFLICT);
  }
  if (content.understandingStatus !== UnderstandStatus.FAILED) {
    return fail(
      ErrorCode.UNDERSTANDING_RETRY_NOT_ALLOWED,
      '仅失败的理解任务可重试',
      HttpStatus.CONFLICT,
      { understandingStatus: content.understandingStatus },
    );
  }

  registerAllProcessors();
  await enqueueUnderstanding(content.id);

  return ok({ contentId: content.id, phase: 'light-filter' }, '已重新入队理解任务');
});
