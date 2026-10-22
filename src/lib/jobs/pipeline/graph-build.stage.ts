import { type Prisma } from '@prisma/client';
import { z } from 'zod';

import { AiError, extractJson } from '@/lib/ai/spark';
import { taskLogger } from '@/lib/jobs/task-logger';
import { prisma } from '@/lib/prisma';

import { type PipelineStageContext } from './understanding-pipeline';

const graphSchema = z.object({
  mergeGroups: z.array(z.object({
    canonicalPointId: z.string().min(1),
    duplicatePointIds: z.array(z.string().min(1)).min(1).max(19),
  })).max(20),
  edges: z.array(z.object({
    sourcePointId: z.string().min(1),
    targetPointId: z.string().min(1),
    relation: z.enum(['PREREQUISITE', 'RELATED', 'EXAMPLE_OF']),
    weight: z.number().min(0).max(1).default(1),
  })).max(100),
});

export const graphExtractionSchema = graphSchema;

const SYSTEM_PROMPT =
  '你是知识图谱助手，仅依据输入知识点输出合法 JSON。必须包含 mergeGroups、edges、examples 三个数组。' +
  '格式：{"mergeGroups":[],"edges":[],"examples":[{"examplePointId":"2","conceptPointId":"1","weight":0.9}]}。' +
  'examples专门填写具体算例与公式或概念之间的联系：examplePointId是算例编号，conceptPointId是它应用的公式或概念编号。' +
  'edges只用于前置或同层相关，格式为{"sourcePointId":"0","targetPointId":"1","relationCode":0,"weight":0.9}。' +
  'relationCode是整数：0表示前置，source是基础、target依赖它；1表示同层相关。不输出英文关系名。' +
  'ID只填输入中的编号字符串；示例仅说明字段格式。只输出摘要明确支持的关系，不确定就省略，不能自环。' +
  '公式和计算算例、概念和应用不是重复，不能合并。通常mergeGroups为空；仅完全同义时填写{"canonicalPointId":"0","duplicatePointIds":["1"]}，重复数组不能为空。' +
  '无某类关系时返回对应空数组；weight为0到1。';
type GraphPoint = { id: string; title: string; summary: string };
type GraphOutput = z.infer<typeof graphSchema>;
type AcceptedMerge = { canonicalPointId: string; duplicatePointIds: string[] };
type AcceptedEdge = {
  sourcePointId: string;
  targetPointId: string;
  relation: GraphOutput['edges'][number]['relation'];
  weight: number;
};

function acceptMerges(groups: GraphOutput['mergeGroups'], pointIds: Set<string>, externallyReferenced: Set<string>): AcceptedMerge[] {
  const usedIds = new Set<string>();
  const accepted: AcceptedMerge[] = [];

  for (const group of groups) {
    const duplicates = [...new Set(group.duplicatePointIds)].filter((id) => id !== group.canonicalPointId);
    const members = [group.canonicalPointId, ...duplicates];
    if (duplicates.length === 0 || members.some((id) => !pointIds.has(id) || usedIds.has(id))) continue;
    if (duplicates.some((id) => externallyReferenced.has(id))) continue;

    for (const id of members) usedIds.add(id);
    accepted.push({ canonicalPointId: group.canonicalPointId, duplicatePointIds: duplicates });
  }
  return accepted;
}

function normalizeEdges(
  edges: GraphOutput['edges'],
  pointIds: Set<string>,
  merges: AcceptedMerge[],
): AcceptedEdge[] {
  const canonicalById = new Map<string, string>();
  for (const merge of merges) {
    for (const duplicateId of merge.duplicatePointIds) canonicalById.set(duplicateId, merge.canonicalPointId);
  }

  const unique = new Map<string, AcceptedEdge>();
  for (const edge of edges) {
    if (!pointIds.has(edge.sourcePointId) || !pointIds.has(edge.targetPointId)) continue;
    let sourcePointId = canonicalById.get(edge.sourcePointId) ?? edge.sourcePointId;
    let targetPointId = canonicalById.get(edge.targetPointId) ?? edge.targetPointId;
    if (sourcePointId === targetPointId) continue;

    // RELATED is symmetric; store one stable orientation even if the model emits both directions.
    if (edge.relation === 'RELATED' && sourcePointId.localeCompare(targetPointId) > 0) {
      [sourcePointId, targetPointId] = [targetPointId, sourcePointId];
    }
    const key = `${sourcePointId}\u0000${edge.relation}\u0000${targetPointId}`;
    const previous = unique.get(key);
    if (!previous || edge.weight > previous.weight) {
      unique.set(key, { sourcePointId, targetPointId, relation: edge.relation, weight: edge.weight });
    }
  }
  return [...unique.values()];
}

/**
 * 阶段 B 可降级子步骤：只在当前内容的既有知识点之间抽关系。
 * 语义抽取/AI 不可用时保留原有图谱，不影响 P0 知识点、闪卡流水线。
 */
export async function buildGraphStage(ctx: PipelineStageContext): Promise<void> {
  const points = await prisma.knowledgePoint.findMany({
    where: { contentId: ctx.contentId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, summary: true },
  });
  if (points.length < 2) {
    await prisma.graphEdge.deleteMany({ where: { contentId: ctx.contentId } });
    return;
  }

  let output: GraphOutput;
  try {
    const actualIdByAlias = new Map(points.map((point: GraphPoint, index: number) => [String(index), point.id]));
    const allowedIds = new Set([...actualIdByAlias.keys(), ...points.map((point: GraphPoint) => point.id)]);
    const modelSchema = graphSchema.extend({
      edges: z.array(z.object({ sourcePointId: z.string().min(1), targetPointId: z.string().min(1), relationCode: z.number().int().min(0).max(1), weight: z.number().min(0).max(1).default(1) })).max(100),
      examples: z.array(z.object({ examplePointId: z.string().min(1), conceptPointId: z.string().min(1), weight: z.number().min(0).max(1).default(1) })).max(100),
    });
    const sourceSchema = modelSchema.superRefine((graph, context) => {
      if (graph.edges.some((edge) => !allowedIds.has(edge.sourcePointId) || !allowedIds.has(edge.targetPointId) || edge.sourcePointId === edge.targetPointId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['edges'], message: '关系必须使用当前输入的不同知识点 ID' });
      }
      if (graph.mergeGroups.some((group) => !allowedIds.has(group.canonicalPointId) || group.duplicatePointIds.some((id) => !allowedIds.has(id) || id === group.canonicalPointId))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['mergeGroups'], message: '合并只能使用当前输入的不同知识点 ID' });
      }
      if (graph.examples.some((edge) => !allowedIds.has(edge.examplePointId) || !allowedIds.has(edge.conceptPointId) || edge.examplePointId === edge.conceptPointId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['examples'], message: '例子和概念必须是当前输入的不同知识点 ID' });
      }
    });
    const pointList = points.map((point: GraphPoint, index: number) =>
      `${JSON.stringify({ id: String(index), title: point.title, summary: point.summary.slice(0, 500) })}`,
    ).join('\n');
    const result = await extractJson<z.infer<typeof sourceSchema>>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `请构建下列知识点的内容局部图谱：\n${pointList}` },
      ],
      sourceSchema,
      { timeoutMs: 45_000, traceId: ctx.traceId, temperature: 0.1, maxTokens: 2_000 },
    );
    const supplementalEdges: GraphOutput['edges'] = [];
    const endpoints = z.object({ sourcePointId: z.string().min(1), targetPointId: z.string().min(1), weight: z.number().min(0).max(1).default(1) });
    const targetedPrompts = [
      {
        relation: 'PREREQUISITE' as const,
        missing: !result.data.edges.some((edge) => edge.relationCode === 0),
        schema: z.object({ edges: z.array(endpoints.extend({ relationCode: z.literal(0) }).strict()).max(100) }),
        prompt: '你是知识点“前置”关系抽取器。只判断两个不同知识点的先后依赖：摘要明确写出“学习B前必须先理解A”或“A是B的前置知识”时，返回从基础A指向依赖B。仅输出合法 JSON，结构为 {"edges":[{"sourcePointId":"0","targetPointId":"1","relationCode":0,"weight":0.9}]}。只允许输入的编号，不允许自环。相关、举例、合并都不属于本次目标，不能输出；无明确前置证据返回空 edges。',
      },
      {
        relation: 'RELATED' as const,
        missing: !result.data.edges.some((edge) => edge.relationCode === 1),
        schema: z.object({ edges: z.array(endpoints.strict()).max(100) }),
        prompt: '你是知识点“同层相关”关系抽取器。只判断两个不同知识点是否在摘要中明确写明为“同层相关知识”或“同一主题的相关知识”。仅输出合法 JSON，结构为 {"edges":[{"sourcePointId":"1","targetPointId":"2","weight":0.9}]}。只允许输入的编号，不允许自环；每对相关知识点只输出一条关系。前置、依赖、举例、合并都不属于本次目标，不能输出；无明确同层相关证据返回空 edges。',
      },
    ];
    for (const target of targetedPrompts) {
      if (!target.missing) continue;
      const targetSchema = target.schema.superRefine((graph, context) => {
        if (graph.edges.some((edge) => !allowedIds.has(edge.sourcePointId) || !allowedIds.has(edge.targetPointId) || edge.sourcePointId === edge.targetPointId)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['edges'], message: '关系必须使用当前输入的不同知识点 ID' });
        }
      });
      try {
        const supplement = await extractJson(
          [{ role: 'system', content: target.prompt }, { role: 'user', content: `请构建下列知识点的内容局部图谱：\n${pointList}` }],
          targetSchema,
          { timeoutMs: 45_000, traceId: ctx.traceId, temperature: 0.1, maxTokens: 2_000 },
        );
        supplementalEdges.push(...supplement.data.edges.map((edge) => ({
          sourcePointId: actualIdByAlias.get(edge.sourcePointId) ?? edge.sourcePointId,
          targetPointId: actualIdByAlias.get(edge.targetPointId) ?? edge.targetPointId,
          relation: target.relation,
          weight: edge.weight,
        })));
      } catch (error) {
        taskLogger.warn('graph-build: targeted relation extraction unavailable', {
          contentId: ctx.contentId,
          traceId: ctx.traceId,
          relation: target.relation,
          code: error instanceof AiError ? error.code : 'UNKNOWN',
        });
      }
    }
    output = {
      mergeGroups: result.data.mergeGroups.map((group) => ({ canonicalPointId: actualIdByAlias.get(group.canonicalPointId) ?? group.canonicalPointId, duplicatePointIds: group.duplicatePointIds.map((id) => actualIdByAlias.get(id) ?? id) })),
      edges: [
        ...result.data.edges.map((edge) => ({ relation: edge.relationCode === 0 ? 'PREREQUISITE' as const : 'RELATED' as const, weight: edge.weight, sourcePointId: actualIdByAlias.get(edge.sourcePointId) ?? edge.sourcePointId, targetPointId: actualIdByAlias.get(edge.targetPointId) ?? edge.targetPointId })),
        ...(result.data.examples ?? []).map((edge) => ({ sourcePointId: actualIdByAlias.get(edge.examplePointId) ?? edge.examplePointId, targetPointId: actualIdByAlias.get(edge.conceptPointId) ?? edge.conceptPointId, relation: 'EXAMPLE_OF' as const, weight: edge.weight })),
        ...supplementalEdges,
      ],
    };
  } catch (error) {
    taskLogger.warn('graph-build: extraction unavailable, previous graph preserved', {
      contentId: ctx.contentId,
      traceId: ctx.traceId,
      code: error instanceof AiError ? error.code : 'UNKNOWN',
    });
    return;
  }

  const pointIds = new Set(points.map((point: GraphPoint) => point.id));
  const duplicateIds = [...new Set(output.mergeGroups.flatMap((group) => group.duplicatePointIds))]
    .filter((id) => pointIds.has(id));
  let externallyReferenced = new Set<string>();
  if (duplicateIds.length > 0) {
    const externalEdges = await prisma.graphEdge.findMany({
      where: {
        AND: [
          { OR: [{ contentId: null }, { contentId: { not: ctx.contentId } }] },
          { OR: [{ sourcePointId: { in: duplicateIds } }, { targetPointId: { in: duplicateIds } }] },
        ],
      },
      select: { sourcePointId: true, targetPointId: true },
    });
    externallyReferenced = new Set(externalEdges.flatMap((edge: { sourcePointId: string; targetPointId: string }) =>
      [edge.sourcePointId, edge.targetPointId],
    ));
  }

  const merges = acceptMerges(output.mergeGroups, pointIds, externallyReferenced);
  const edges = normalizeEdges(output.edges, pointIds, merges);
  const mergedDuplicateIds = merges.flatMap((merge) => merge.duplicatePointIds);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const point of points) {
      await tx.graphNode.upsert({
        where: { pointId: point.id },
        update: {},
        create: { pointId: point.id, nodeType: 'CONCEPT' },
      });
    }
    const graphNodes = await tx.graphNode.findMany({
      where: { pointId: { in: points.map((point: GraphPoint) => point.id) } },
      select: { pointId: true, aliases: true },
    });
    const nodeByPointId = new Map(graphNodes.map((node) => [node.pointId, node]));

    for (const merge of merges) {
      const canonicalNode = nodeByPointId.get(merge.canonicalPointId);
      if (!canonicalNode) continue;
      const duplicatePointTitles = points
        .filter((point: GraphPoint) => merge.duplicatePointIds.includes(point.id))
        .map((point: GraphPoint) => point.title);
      const duplicateAliases = merge.duplicatePointIds.flatMap((id) => nodeByPointId.get(id)?.aliases ?? []);
      const aliases = [...new Set([...canonicalNode.aliases, ...duplicatePointTitles, ...duplicateAliases])]
        .filter((alias) => alias.length > 0 && alias !== points.find((point: GraphPoint) => point.id === merge.canonicalPointId)?.title);
      await tx.graphNode.update({ where: { pointId: merge.canonicalPointId }, data: { aliases } });
    }

    await tx.graphEdge.deleteMany({ where: { contentId: ctx.contentId } });
    if (mergedDuplicateIds.length > 0) {
      await tx.graphNode.deleteMany({ where: { pointId: { in: mergedDuplicateIds } } });
    }
    if (edges.length > 0) {
      await tx.graphEdge.createMany({
        data: edges.map((edge) => ({ ...edge, contentId: ctx.contentId })),
      });
    }
  });

  taskLogger.info('graph-build: graph stored', {
    contentId: ctx.contentId,
    traceId: ctx.traceId,
    nodes: points.length - mergedDuplicateIds.length,
    merged: mergedDuplicateIds.length,
    edges: edges.length,
  });
}
