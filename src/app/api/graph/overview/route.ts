import type { EdgeRelation, NodeType, Prisma } from '@prisma/client';
import { ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { buildGraphPointDetails, type GraphPointDetails } from '@/lib/domain/graph-details';
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

type PointRow = {
  id: string;
  title: string;
  contentId: string;
  refs: Prisma.JsonValue;
  graphNode: { nodeType: NodeType; aliases: string[] } | null;
  masteries: { score: number; isWeak: boolean; reviewCount: number; correctRate: number | null }[];
};

type EdgeRow = {
  sourcePointId: string;
  targetPointId: string;
  relation: EdgeRelation;
  weight: number;
  contentId: string | null;
};

type AggregateNode = {
  pointId: string;
  title: string;
  nodeType: string;
  pointIds: Set<string>;
  contentIds: Set<string>;
  aliases: Set<string>;
  masteryTotal: number;
  weakPointCount: number;
  pointCount: number;
  reviewCount: number;
  correctRateTotal: number;
  correctRateWeight: number;
  relatedNoteCount: number;
  relatedFlashcardCount: number;
  lastReviewedAt: string | null;
};

type AggregateEdge = {
  source: string;
  target: string;
  relation: string;
  contentIds: Set<string>;
  weightTotal: number;
  count: number;
};

function normalizeAlias(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function aggregateNodes(points: PointRow[], detailsByPoint: ReadonlyMap<string, GraphPointDetails>, practiceByPoint: ReadonlyMap<string, { total: number; correct: number }>): {
  nodes: AggregateNode[];
  pointToNode: Map<string, string>;
} {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    const parentIndex = parent[index];
    if (parentIndex === undefined || parentIndex === index) return index;
    parent[index] = find(parentIndex);
    return parent[index] ?? index;
  };
  const unite = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const labelOwners = new Map<string, number>();
  points.forEach((point, index) => {
    const nodeType = point.graphNode?.nodeType ?? 'CONCEPT';
    const labels = [point.title, ...(point.graphNode?.aliases ?? [])];
    for (const label of labels) {
      const normalized = normalizeAlias(label);
      if (!normalized) continue;
      const key = `${nodeType}:${normalized}`;
      const existing = labelOwners.get(key);
      if (existing === undefined) labelOwners.set(key, index);
      else unite(existing, index);
    }
  });

  const groups = new Map<number, PointRow[]>();
  points.forEach((point, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(point);
    groups.set(root, group);
  });

  const nodes: AggregateNode[] = [];
  const pointToNode = new Map<string, string>();
  for (const group of groups.values()) {
    const representative = group[0];
    if (!representative) continue;
    const canonicalPointId = representative.id;
    const title = representative.title;
    const nodeType = nodeTypeLabels[representative.graphNode?.nodeType ?? 'CONCEPT'];
    const aliases = new Set<string>();
    let masteryTotal = 0;
    let weakPointCount = 0;
    let reviewCount = 0;
    let correctRateTotal = 0;
    let correctRateWeight = 0;
    let relatedNoteCount = 0;
    let relatedFlashcardCount = 0;
    let lastReviewedAt: string | null = null;
    for (const point of group) {
      pointToNode.set(point.id, canonicalPointId);
      if (point.title !== title) aliases.add(point.title);
      for (const alias of point.graphNode?.aliases ?? []) {
        if (alias !== title) aliases.add(alias);
      }
      const mastery = point.masteries[0];
      masteryTotal += mastery?.score ?? 0;
      if (mastery?.isWeak) weakPointCount += 1;
      reviewCount += mastery?.reviewCount ?? 0;
      const practice = practiceByPoint.get(point.id);
      correctRateTotal += practice?.correct ?? 0;
      correctRateWeight += practice?.total ?? 0;
      const pointDetails = detailsByPoint.get(point.id);
      relatedNoteCount += pointDetails?.relatedNoteCount ?? 0;
      relatedFlashcardCount += pointDetails?.relatedFlashcardCount ?? 0;
      const pointLastReviewedAt = pointDetails?.lastReviewedAt;
      if (pointLastReviewedAt && (!lastReviewedAt || pointLastReviewedAt > lastReviewedAt)) {
        lastReviewedAt = pointLastReviewedAt;
      }
    }
    nodes.push({
      pointId: canonicalPointId,
      title,
      nodeType,
      pointIds: new Set(group.map((point) => point.id)),
      contentIds: new Set(group.map((point) => point.contentId)),
      aliases,
      masteryTotal,
      weakPointCount,
      pointCount: group.length,
      reviewCount,
      correctRateTotal,
      correctRateWeight,
      relatedNoteCount,
      relatedFlashcardCount,
      lastReviewedAt,
    });
  }
  nodes.sort((left, right) => left.title.localeCompare(right.title) || left.pointId.localeCompare(right.pointId));
  return { nodes, pointToNode };
}

function aggregateEdges(
  edges: EdgeRow[],
  pointToNode: Map<string, string>,
): AggregateEdge[] {
  const groups = new Map<string, AggregateEdge>();
  for (const edge of edges) {
    const source = pointToNode.get(edge.sourcePointId);
    const target = pointToNode.get(edge.targetPointId);
    if (!source || !target || source === target || !edge.contentId) continue;
    const relation = relationLabels[edge.relation];
    const key = `${source}\u0000${target}\u0000${relation}`;
    const aggregate = groups.get(key) ?? {
      source,
      target,
      relation,
      contentIds: new Set<string>(),
      weightTotal: 0,
      count: 0,
    };
    aggregate.contentIds.add(edge.contentId);
    aggregate.weightTotal += edge.weight;
    aggregate.count += 1;
    groups.set(key, aggregate);
  }
  return [...groups.values()].sort((left, right) =>
    left.source.localeCompare(right.source)
    || left.target.localeCompare(right.target)
    || left.relation.localeCompare(right.relation),
  );
}

/** GET /api/graph/overview：聚合当前学习者拥有的内容图谱。 */
export const GET = withAuth(async (_request, { user }) => {
  const contents = await prisma.learningContent.findMany({
    where: { ownerId: user.id },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const contentIds = contents.map((content) => content.id);
  if (contentIds.length === 0) {
    return ok({ nodes: [], edges: [], summary: { contentCount: 0, nodeCount: 0, weakPointCount: 0, edgeCount: 0 } });
  }

  const points = await prisma.knowledgePoint.findMany({
    where: { contentId: { in: contentIds } },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      contentId: true,
      refs: true,
      graphNode: { select: { nodeType: true, aliases: true } },
      masteries: {
        where: { learnerId: user.id },
        select: { score: true, isWeak: true, reviewCount: true, correctRate: true },
        take: 1,
      },
    },
  });
  const pointIds = points.map((point) => point.id);
  const [edges, notes, flashcards, practiceRecords] = pointIds.length === 0
    ? [[], [], [], []]
    : await Promise.all([
      prisma.graphEdge.findMany({
      where: {
        contentId: { in: contentIds },
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
        contentId: true,
      },
      }),
      prisma.note.findMany({
        where: { ownerId: user.id, contentId: { in: contentIds } },
        select: { contentId: true, ref: true },
      }),
      prisma.flashcard.findMany({
        where: { ownerId: user.id, pointId: { in: pointIds } },
        select: {
          pointId: true,
          reviewLogs: { orderBy: { reviewedAt: 'desc' }, take: 1, select: { reviewedAt: true } },
        },
      }),
      prisma.exerciseRecord.findMany({
        where: { learnerId: user.id, exercise: { contentId: { in: contentIds }, pointId: { in: pointIds } } },
        select: { correct: true, exercise: { select: { pointId: true } } },
      }),
    ]);

  const detailsByPoint = buildGraphPointDetails(points, notes, flashcards);
  const practiceByPoint = new Map<string, { total: number; correct: number }>();
  for (const record of practiceRecords) {
    const counts = practiceByPoint.get(record.exercise.pointId) ?? { total: 0, correct: 0 };
    counts.total += 1;
    if (record.correct) counts.correct += 1;
    practiceByPoint.set(record.exercise.pointId, counts);
  }
  const aggregated = aggregateNodes(points, detailsByPoint, practiceByPoint);
  const aggregatedEdges = aggregateEdges(edges, aggregated.pointToNode);
  const weakPointCount = points.reduce(
    (count, point) => count + (point.masteries[0]?.isWeak ? 1 : 0),
    0,
  );

  return ok({
    nodes: aggregated.nodes.map((node) => ({
      pointId: node.pointId,
      title: node.title,
      nodeType: node.nodeType,
      pointIds: [...node.pointIds].sort(),
      contentIds: [...node.contentIds].sort(),
      aliases: [...node.aliases].sort((left, right) => left.localeCompare(right)),
      mastery: node.pointCount === 0 ? 0 : roundScore(node.masteryTotal / node.pointCount),
      isWeak: node.weakPointCount > 0,
      weakPointCount: node.weakPointCount,
      reviewCount: node.reviewCount,
      correctRate: node.correctRateWeight === 0 ? null : roundScore(node.correctRateTotal / node.correctRateWeight),
      relatedNoteCount: node.relatedNoteCount,
      relatedFlashcardCount: node.relatedFlashcardCount,
      lastReviewedAt: node.lastReviewedAt,
    })),
    edges: aggregatedEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      contentIds: [...edge.contentIds].sort(),
      weight: edge.count === 0 ? 0 : roundScore(edge.weightTotal / edge.count),
    })),
    summary: {
      contentCount: contents.length,
      nodeCount: aggregated.nodes.length,
      weakPointCount,
      edgeCount: aggregatedEdges.length,
    },
  });
});
