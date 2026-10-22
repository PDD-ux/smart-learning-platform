import { JobType, UnderstandStatus } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { prisma } from '@/lib/prisma';

/**
 * 理解任务状态（tasks.md §6.5）
 * ------------------------------------------------------------
 * GET /api/contents/:id/understanding/status
 *   返回 phase（none/light-filter/deep-extract/product-gen/completed/failed）
 *   与 stageDetail（selectFrames/classify/asr/extract），支撑前端流水线进度环。
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2-(3)。
 */

type Phase = 'none' | 'light-filter' | 'deep-extract' | 'product-gen' | 'completed' | 'failed';
type StageState = 'done' | 'error';

const RUNNABLE_STAGES = new Set(['light-filter', 'deep-extract', 'product-gen']);

function mapPhase(status: UnderstandStatus, stage: string | null): Phase {
  if (status === UnderstandStatus.NONE) return 'none';
  if (status === UnderstandStatus.COMPLETED) return 'completed';
  if (status === UnderstandStatus.FAILED) return 'failed';
  return stage && RUNNABLE_STAGES.has(stage) ? (stage as Phase) : 'light-filter';
}

export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const [job, transcriptCount, textBlockCount, pointCount] = await Promise.all([
    prisma.asyncJob.findFirst({
      where: { contentId: params.id, jobType: JobType.UNDERSTANDING },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.transcriptSegment.count({ where: { contentId: params.id } }),
    prisma.textBlock.count({ where: { contentId: params.id } }),
    prisma.knowledgePoint.count({ where: { contentId: params.id } }),
  ]);

  const phase = mapPhase(content.understandingStatus, job?.stage ?? null);

  // stageDetail 由产物反推（阶段 A/B 各子步骤完成情况）
  const stageDetail: Partial<Record<'selectFrames' | 'classify' | 'asr' | 'extract', StageState>> = {};
  if (textBlockCount > 0) {
    stageDetail.classify = 'done';
    stageDetail.selectFrames = 'done';
  }
  if (transcriptCount > 0) stageDetail.asr = 'done';
  if (pointCount > 0) stageDetail.extract = 'done';

  return ok({
    contentId: content.id,
    phase,
    stageDetail,
    ...(phase === 'failed' ? { failureReason: job?.errorReason ?? undefined } : {}),
  });
});
