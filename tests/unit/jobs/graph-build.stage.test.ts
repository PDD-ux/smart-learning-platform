import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const mocks = vi.hoisted(() => ({
  pointFindMany: vi.fn(),
  externalEdges: vi.fn(),
  graphNodeUpsert: vi.fn(),
  graphNodeFindMany: vi.fn(),
  graphNodeUpdate: vi.fn(),
  graphNodeDeleteMany: vi.fn(),
  graphEdgeDeleteMany: vi.fn(),
  graphEdgeCreateMany: vi.fn(),
  extractJson: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    knowledgePoint: { findMany: mocks.pointFindMany },
    graphEdge: { findMany: mocks.externalEdges, deleteMany: mocks.graphEdgeDeleteMany },
    $transaction: (fn: (tx: unknown) => unknown) => fn({
      graphNode: {
        upsert: mocks.graphNodeUpsert,
        findMany: mocks.graphNodeFindMany,
        update: mocks.graphNodeUpdate,
        deleteMany: mocks.graphNodeDeleteMany,
      },
      graphEdge: { deleteMany: mocks.graphEdgeDeleteMany, createMany: mocks.graphEdgeCreateMany },
    }),
  },
}));

vi.mock('@/lib/ai/spark', () => {
  class AiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { extractJson: mocks.extractJson, AiError };
});

vi.mock('@/lib/jobs/task-logger', () => ({ taskLogger: { info: vi.fn(), warn: vi.fn() } }));

import { graphExtractionSchema, buildGraphStage } from '@/lib/jobs/pipeline/graph-build.stage';

const ctx = { contentId: 'c1', traceId: 't1', degraded: { infer: false, asr: false } };
const points = [
  { id: 'p1', title: '函数概念', summary: '基本定义' },
  { id: 'p2', title: '函数的定义', summary: '同一概念的另一种表述' },
  { id: 'p3', title: '导数', summary: '函数变化率' },
];

describe('graphBuildStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractJson.mockResolvedValue({ data: { edges: [] } });
    mocks.pointFindMany.mockResolvedValue(points);
    mocks.externalEdges.mockResolvedValue([]);
    mocks.graphNodeUpsert.mockResolvedValue({});
    mocks.graphNodeFindMany.mockResolvedValue([
      { pointId: 'p1', aliases: [] },
      { pointId: 'p2', aliases: ['函数定义'] },
      { pointId: 'p3', aliases: [] },
    ]);
    mocks.graphNodeUpdate.mockResolvedValue({});
    mocks.graphNodeDeleteMany.mockResolvedValue({ count: 1 });
    mocks.graphEdgeDeleteMany.mockResolvedValue({ count: 0 });
    mocks.graphEdgeCreateMany.mockResolvedValue({ count: 2 });
  });

  it('validates graph relation types, IDs and confidence bounds', () => {
    expect(graphExtractionSchema.safeParse({}).success).toBe(false);
    expect(graphExtractionSchema.safeParse({ mergeGroups: [], edges: [] }).success).toBe(true);
    expect(graphExtractionSchema.safeParse({
      mergeGroups: [],
      edges: [{ sourcePointId: 'p1', targetPointId: 'p2', relation: 'RELATED', weight: 0.8 }],
    }).success).toBe(true);
    expect(graphExtractionSchema.safeParse({
      edges: [{ sourcePointId: 'p1', targetPointId: 'p2', relation: 'UNKNOWN' }],
    }).success).toBe(false);
    expect(graphExtractionSchema.safeParse({
      edges: [{ sourcePointId: 'p1', targetPointId: 'p2', relation: 'RELATED', weight: 1.1 }],
    }).success).toBe(false);
  });

  it('validates model endpoint IDs against the current content before persistence', async () => {
    mocks.extractJson.mockResolvedValueOnce({ data: { mergeGroups: [], edges: [] } });
    await buildGraphStage(ctx);
    const schema = mocks.extractJson.mock.calls[0][1] as z.ZodType<unknown>;
    const edge = { sourcePointId: 'p1', targetPointId: 'p3', relationCode: 1, weight: 0.8 };
    expect(schema.safeParse({ mergeGroups: [], edges: [edge], examples: [] }).success).toBe(true);
    expect(schema.safeParse({ mergeGroups: [], edges: [{ ...edge, targetPointId: 'outside' }], examples: [] }).success).toBe(false);
    expect(schema.safeParse({ mergeGroups: [], edges: [{ ...edge, targetPointId: 'p1' }], examples: [] }).success).toBe(false);
    expect(schema.safeParse({ mergeGroups: [{ canonicalPointId: 'p1', duplicatePointIds: ['outside'] }], edges: [], examples: [] }).success).toBe(false);
    expect(schema.safeParse({ mergeGroups: [], edges: [], examples: [{ examplePointId: '2', conceptPointId: '1', weight: 0.9 }] }).success).toBe(true);
    expect(schema.safeParse({ mergeGroups: [], edges: [], examples: [{ examplePointId: '2', conceptPointId: 'outside' }] }).success).toBe(false);
  });

  it('merges duplicate graph nodes and stores only valid, deduplicated edges', async () => {
    mocks.extractJson.mockResolvedValueOnce({
      data: {
        mergeGroups: [{ canonicalPointId: 'p1', duplicatePointIds: ['p2'] }],
        edges: [
          { sourcePointId: 'p2', targetPointId: 'p3', relationCode: 0, weight: 0.8 },
          { sourcePointId: 'p1', targetPointId: 'p3', relationCode: 1, weight: 0.7 },
          { sourcePointId: 'p3', targetPointId: 'p1', relationCode: 1, weight: 0.9 },
          { sourcePointId: 'p1', targetPointId: 'p2', relationCode: 1, weight: 1 },
          { sourcePointId: 'outside', targetPointId: 'p3', relationCode: 1, weight: 1 },
        ],
      },
    });

    await buildGraphStage(ctx);

    expect(mocks.graphNodeUpdate).toHaveBeenCalledWith({
      where: { pointId: 'p1' },
      data: { aliases: ['函数的定义', '函数定义'] },
    });
    expect(mocks.graphNodeDeleteMany).toHaveBeenCalledWith({ where: { pointId: { in: ['p2'] } } });
    expect(mocks.graphEdgeDeleteMany).toHaveBeenCalledWith({ where: { contentId: 'c1' } });
    expect(mocks.graphEdgeCreateMany).toHaveBeenCalledWith({
      data: [
        { contentId: 'c1', sourcePointId: 'p1', targetPointId: 'p3', relation: 'PREREQUISITE', weight: 0.8 },
        { contentId: 'c1', sourcePointId: 'p1', targetPointId: 'p3', relation: 'RELATED', weight: 0.9 },
      ],
    });
  });

  it('does not merge a node referenced by another graph boundary', async () => {
    mocks.externalEdges.mockResolvedValue([{ sourcePointId: 'p2', targetPointId: 'other' }]);
    mocks.extractJson.mockResolvedValueOnce({
      data: {
        mergeGroups: [{ canonicalPointId: 'p1', duplicatePointIds: ['p2'] }],
        edges: [{ sourcePointId: 'p2', targetPointId: 'p3', relationCode: 1, weight: 1 }],
      },
    });

    await buildGraphStage(ctx);

    expect(mocks.graphNodeUpdate).not.toHaveBeenCalled();
    expect(mocks.graphNodeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.graphEdgeCreateMany).toHaveBeenCalledWith({
      data: [{ contentId: 'c1', sourcePointId: 'p2', targetPointId: 'p3', relation: 'RELATED', weight: 1 }],
    });
  });

  it('preserves existing graph when AI extraction is unavailable', async () => {
    mocks.extractJson.mockRejectedValueOnce(new Error('TIMEOUT'));

    await expect(buildGraphStage(ctx)).resolves.toBeUndefined();

    expect(mocks.graphEdgeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.graphEdgeCreateMany).not.toHaveBeenCalled();
  });

  it('maps short aliases and named examples to exact database IDs and direction', async () => {
    mocks.extractJson.mockResolvedValueOnce({ data: { mergeGroups: [], edges: [], examples: [{ examplePointId: '2', conceptPointId: '0', weight: 0.9 }] } });
    await buildGraphStage(ctx);
    expect(mocks.graphEdgeCreateMany).toHaveBeenCalledWith({ data: [{ contentId: 'c1', sourcePointId: 'p3', targetPointId: 'p1', relation: 'EXAMPLE_OF', weight: 0.9 }] });
  });

  it('clears stale content edges when fewer than two knowledge points exist', async () => {
    mocks.pointFindMany.mockResolvedValueOnce([points[0]]);

    await buildGraphStage(ctx);

    expect(mocks.extractJson).not.toHaveBeenCalled();
    expect(mocks.graphEdgeDeleteMany).toHaveBeenCalledWith({ where: { contentId: 'c1' } });
  });

  it('adds separately extracted prerequisite and related relations when the combined call omits them', async () => {
    mocks.extractJson
      .mockResolvedValueOnce({ data: { mergeGroups: [], edges: [], examples: [] } })
      .mockResolvedValueOnce({ data: { edges: [{ sourcePointId: '0', targetPointId: '1', relationCode: 0, weight: 0.9 }] } })
      .mockResolvedValueOnce({ data: { edges: [{ sourcePointId: '1', targetPointId: '2', weight: 0.8 }] } });

    await buildGraphStage(ctx);

    expect(mocks.extractJson).toHaveBeenCalledTimes(3);
    const prerequisiteSchema = mocks.extractJson.mock.calls[1][1] as z.ZodType<unknown>;
    const relatedSchema = mocks.extractJson.mock.calls[2][1] as z.ZodType<unknown>;
    expect(prerequisiteSchema.safeParse({ edges: [{ sourcePointId: '0', targetPointId: '1', relationCode: 0, weight: 0.9 }] }).success).toBe(true);
    expect(prerequisiteSchema.safeParse({ edges: [{ sourcePointId: '0', targetPointId: '0', relationCode: 0, weight: 0.9 }] }).success).toBe(false);
    expect(prerequisiteSchema.safeParse({ edges: [{ sourcePointId: 'outside', targetPointId: '1', relationCode: 0, weight: 0.9 }] }).success).toBe(false);
    expect(relatedSchema.safeParse({ edges: [{ sourcePointId: '1', targetPointId: '2', weight: 0.8 }] }).success).toBe(true);
    expect(relatedSchema.safeParse({ edges: [{ sourcePointId: '1', targetPointId: '2', relationCode: 0, weight: 0.8 }] }).success).toBe(false);
    expect(mocks.graphEdgeCreateMany).toHaveBeenCalledWith({ data: [
      { contentId: 'c1', sourcePointId: 'p1', targetPointId: 'p2', relation: 'PREREQUISITE', weight: 0.9 },
      { contentId: 'c1', sourcePointId: 'p2', targetPointId: 'p3', relation: 'RELATED', weight: 0.8 },
    ] });
  });
});
