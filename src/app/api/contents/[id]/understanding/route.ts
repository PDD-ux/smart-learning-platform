import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { understandStatusLabel } from '@/lib/domain/content-status';
import {
  toKnowledgePointDto,
  toTextBlockDto,
  toTranscriptSegmentDto,
} from '@/lib/domain/understanding-mapper';
import { prisma } from '@/lib/prisma';

/**
 * 理解产物（tasks.md §6.5）
 * ------------------------------------------------------------
 * GET /api/contents/:id/understanding
 *   返回转写段落 / 文本块 / 知识点；无产物时返回空产物 + 降级提示。
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2-(3)。
 */

export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const [segments, blocks, points] = await Promise.all([
    prisma.transcriptSegment.findMany({ where: { contentId: params.id }, orderBy: { seq: 'asc' } }),
    prisma.textBlock.findMany({ where: { contentId: params.id }, orderBy: { sequence: 'asc' } }),
    prisma.knowledgePoint.findMany({ where: { contentId: params.id }, orderBy: { createdAt: 'asc' } }),
  ]);

  const hasProducts = segments.length > 0 || blocks.length > 0 || points.length > 0;

  return ok({
    contentId: content.id,
    transcriptSegments: segments.map(toTranscriptSegmentDto),
    textBlocks: blocks.map(toTextBlockDto),
    knowledgePoints: points.map(toKnowledgePointDto),
    status: understandStatusLabel(content.understandingStatus),
    ...(hasProducts ? {} : { degradation: '尚未生成可用的解析内容' }),
  });
});
