import type { EdgeRelation, NodeType } from '@prisma/client';
import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { buildGraphPointDetails } from '@/lib/domain/graph-details';
import { prisma } from '@/lib/prisma';

const nodeTypeLabels: Record<NodeType, string> = {
  CONCEPT: 'concept',
  FORMULA: 'formula',
  METHOD: 'method',
  THEOREM: 'theorem',
};

const relationLabels: Record<EdgeRelation, string> = {
  PREREQUISITE: 'prerequisite',
  RELATED: 'related',
  EXAMPLE_OF: 'example_of',
};

/** GET /api/contents/:id/graph：返回本内容图谱及当前用户的掌握度。 */
export const GET = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const content = await prisma.learningContent.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true },
  });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const points = await prisma.knowledgePoint.findMany({
    where: { contentId: content.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      contentId: true,
      refs: true,
      graphNode: { select: { nodeType: true } },
      masteries: {
        where: { learnerId: user.id },
        select: { score: true, isWeak: true, reviewCount: true, correctRate: true },
        take: 1,
      },
    },
  });

  const pointIds = points.map((point) => point.id);
  const [edgeRows, noteRows, flashcardRows] = pointIds.length > 0
    ? await Promise.all([
      prisma.graphEdge.findMany({
      where: {
        contentId: content.id,
        sourcePointId: { in: pointIds },
        targetPointId: { in: pointIds },
      },
      orderBy: [
        { sourcePointId: 'asc' },
        { targetPointId: 'asc' },
        { relation: 'asc' },
      ],
      select: {
        sourcePointId: true,
        targetPointId: true,
        relation: true,
        weight: true,
      },
      }),
      prisma.note.findMany({
        where: { ownerId: user.id, contentId: content.id },
        select: { contentId: true, ref: true },
      }),
      prisma.flashcard.findMany({
        where: { ownerId: user.id, pointId: { in: pointIds } },
        select: {
          pointId: true,
          reviewLogs: { orderBy: { reviewedAt: 'desc' }, take: 1, select: { reviewedAt: true } },
        },
      }),
    ])
    : [[], [], []];
  const detailsByPoint = buildGraphPointDetails(points, noteRows, flashcardRows);

  return ok({
    nodes: points.map((point) => ({
      pointId: point.id,
      title: point.title,
      nodeType: nodeTypeLabels[point.graphNode?.nodeType ?? 'CONCEPT'],
      mastery: point.masteries[0]?.score ?? 0,
      isWeak: point.masteries[0]?.isWeak ?? false,
      reviewCount: point.masteries[0]?.reviewCount ?? 0,
      correctRate: point.masteries[0]?.correctRate ?? null,
      relatedNoteCount: detailsByPoint.get(point.id)?.relatedNoteCount ?? 0,
      relatedFlashcardCount: detailsByPoint.get(point.id)?.relatedFlashcardCount ?? 0,
      lastReviewedAt: detailsByPoint.get(point.id)?.lastReviewedAt ?? null,
    })),
    edges: edgeRows.map((edge) => ({
      source: edge.sourcePointId,
      target: edge.targetPointId,
      relation: relationLabels[edge.relation],
      weight: edge.weight,
    })),
  });
});
