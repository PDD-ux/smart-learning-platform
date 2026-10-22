import { NodeType, type Prisma } from '@prisma/client';
import { z } from 'zod';

import { checkContent } from '@/lib/ai/content-guard';
import { AiError, extractJson, type ChatMessage, type ChatOptions } from '@/lib/ai/spark';
import { contentRefSchema, isRefInRange, type ContentRef } from '@/lib/domain/content-ref';
import { prisma } from '@/lib/prisma';
import { taskLogger } from '@/lib/jobs/task-logger';

import { buildStructuredContext, knowledgeVideoWindows, type StructuredContext } from './context-builder';
import { buildGraphStage } from './graph-build.stage';
import { documentContexts, documentModelProvider } from './document-context';
import { extractDocumentCandidates } from './document-extraction';
import { documentFacts, parseDocumentFactSelection, documentQuote, documentTextKey, isDocumentNavigation, uniqueDocumentFacts } from './document-quality';
import { registerPipelineStage, type PipelineStageContext } from './understanding-pipeline';
import { VIDEO_SELECTION_PROMPT, videoSelectionSchema } from './video-quality';

/**
 * 阶段 B：云端深度理解 · 知识点抽取（tasks.md §6.4）
 * ------------------------------------------------------------
 * 结构上下文 → `extractJson` 抽取知识点（zod 强校验）→ 输出侧 `checkContent` 过滤
 * → 入库 `KnowledgePoint` 并 upsert 图谱节点（`GraphNode`）。
 * 幂等：重跑先删该内容既有知识点（级联清理图谱节点）再整批写入。
 * 必需阶段：模型失败或无可用知识点时抛错，替换前保留旧产物；长视频真正空窗可跳过。
 */

const pointSchema = z.object({
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(1000),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  // 星火偶尔会漏掉非核心字段；保留知识点并使用中性重要度，而不是丢弃整批结果。
  importance: z.number().int().min(1).max(5).default(3),
  refs: z.array(contentRefSchema).max(20).default([]),
  sourceIds: z.array(z.string().min(1).max(20)).max(20).default([]),
});

export const knowledgeExtractionSchema = z.object({
  points: z.array(pointSchema).min(1).max(20),
});

const SYSTEM_PROMPT =
  '你是学习内容结构化助手，只返回可被JSON.parse解析的对象，不要Markdown或对象外文字。' +
  '格式：{"points":[{"title":"知识点标题","summary":"依据资料的摘要","tags":["标签"],"importance":3,"sourceIds":["S1"]}]}。' +
  'importance为1~5整数。每个知识点必须选择实际支持摘要的sourceIds来源编号；无法找到支持来源的知识点不要输出，不能编造编号。' +
  '每个sourceIds数组最多20个编号，优先选择1至5个最直接的依据，不要列出整张图片的全部OCR编号。' +
  '编号只属于本次提供的来源。精确视频时间或文档页码由后端映射，不要从正文数字猜测定位。' +
  '旧refs仅可复制真实来源标签（例如视频转写 timestampSec=N），不得猜测或用邻近时间替代。' +
  '学习者笔记不授权来源。保证JSON字符串转义合法。';

const WINDOW_PROMPT =
  '你是课堂知识整理助手。本次只处理一个时间窗口，抽取1或2个核心知识点。' +
  '只返回合法JSON对象，结构如：{"points":[{"title":"核心概念","summary":"依据来源的简短自然语言解释。","sourceIds":["S1"]}]}。' +
  'title不超过50字，summary不超过200字。用自然语言概括，不复制代码、代码围栏、英文双引号或多行文本。' +
  '每个sourceIds数组最多20个编号，优先选择1至5个最直接的依据。每个知识点选择实际支持它的来源编号，不编造编号、不借其他窗口来源；时间由后端映射，不生成refs。' +
  '不要额外字段或JSON外文字。字符串内若出现引号必须合法转义。';

const DOCUMENT_PROMPT =
  '你是文档学习整理助手。本批服务器已从真实原文分句列出F编号事实，请精选1至3条适合复习的具体事实。' +
  '只输出单行：事实:F1,F2。不得输出标题、摘要、解释、JSON、Markdown或其它文字。只选择本批存在且不重复的编号，正文与页码由服务器恢复。' +
  '优先具体定义、条件、公式或带明确对象的数值。不要目录、封面、孤立标题或泛泛评价，不推导命题趋势；不要将题目选项当成已证明的答案。';

export async function deepExtractStage(ctx: PipelineStageContext): Promise<void> {
  const content = await prisma.learningContent.findUnique({
    where: { id: ctx.contentId },
    select: { ownerId: true, contentType: true, format: true, durationSec: true, pageCount: true },
  });
  if (!content) {
    throw new Error(`content not found: ${ctx.contentId}`);
  }

  const windows = content.contentType === 'VIDEO' ? knowledgeVideoWindows(content.durationSec ?? 0) : [];
  let points: z.infer<typeof knowledgeExtractionSchema>['points'] = [];
  let truncated = false;
  if (content.contentType === 'DOCUMENT' && ['PDF', 'MD', 'TXT'].includes(content.format)) {
    const fullContext = await buildStructuredContext(ctx.contentId, Number.MAX_SAFE_INTEGER);
    // Classify whole blocks before splitting: a later directory fragment may no longer contain its heading.
    const navigationRefs = new Set(fullContext.sourceSegments.filter((source): boolean => isDocumentNavigation(source.text))
      .map((source): string => JSON.stringify(source.ref)));
    const contexts = documentContexts(fullContext, content.pageCount);
    for (const [index, context] of contexts.entries()) {
      const sourceSegments = context.sourceSegments.filter((source): boolean => !navigationRefs.has(JSON.stringify(source.ref)));
      if (!sourceSegments.length) {
        taskLogger.info('deep-extract: navigation-only document batch', { contentId: ctx.contentId, traceId: ctx.traceId, batchIndex: index });
        continue;
      }
      const bodyContext = { ...context, sourceSegments, sourceRefs: sourceSegments.map((source): ContentRef => source.ref),
        text: sourceSegments.map((source): string => source.text).join('\n'), stats: { ...context.stats, textBlockCount: sourceSegments.length } };
      const extracted = await extractKnowledgeContext(ctx, content, bodyContext, 'document');
      points.push(...extracted);
      taskLogger.info('deep-extract: document batch processed', { contentId: ctx.contentId, traceId: ctx.traceId,
        batchIndex: index, batchCount: contexts.length, points: extracted.length,
        pages: [...new Set(context.sourceRefs.flatMap((ref): number[] => ref.type === 'document' ? [ref.page] : []))] });
    }
    points = uniqueDocumentFacts(points);
    if (!points.length) throw new AiError('文档没有可提取的正文事实，封面或目录不足以生成复习产物。', 'SCHEMA_INVALID', 502);
  } else if (windows.length > 0) {
    for (const [index, window] of windows.entries()) {
      const context = await buildStructuredContext(ctx.contentId, 6_000, window);
      const extracted = await extractKnowledgeContext(ctx, content, context, 'video');
      points.push(...extracted);
      truncated ||= context.truncated;
      taskLogger.info('deep-extract: video window processed', {
        contentId: ctx.contentId, traceId: ctx.traceId, windowIndex: index,
        startSec: window.startSec, endSec: window.endSec, points: extracted.length,
        sourceCount: context.sourceRefs.length, truncated: context.truncated,
      });
    }
    if (points.length === 0) throw new AiError('所有时间窗口均无可引用知识点', 'SCHEMA_INVALID', 502);
  } else {
    const context = await buildStructuredContext(ctx.contentId);
    points = await extractKnowledgeContext(ctx, content, context, 'single');
    truncated = context.truncated;
    if (points.length === 0) throw new AiError('没有可用知识点，请检查原文依据或模型配置后重试。', 'SCHEMA_INVALID', 502);
  }

  const extracted = points.length;
  points = points.filter((point): boolean => checkContent(`${point.title}\n${point.summary}`).safe);
  if (points.length === 0) throw new AiError('知识点未通过内容校验，未替换原学习产物。', 'SCHEMA_INVALID', 502);
  let stored = 0;
  const blocked = extracted - points.length;
  await prisma.$transaction(async (tx): Promise<void> => {
    await tx.knowledgePoint.deleteMany({ where: { contentId: ctx.contentId } });
    for (const point of points) {
      const created = await tx.knowledgePoint.create({ data: {
        contentId: ctx.contentId, ownerId: content.ownerId, title: point.title,
        summary: point.summary, tags: point.tags, importance: point.importance,
        refs: point.refs as Prisma.InputJsonValue,
      } });
      await tx.graphNode.upsert({ where: { pointId: created.id }, update: {},
        create: { pointId: created.id, nodeType: NodeType.CONCEPT } });
      stored += 1;
    }
  });
  taskLogger.info('deep-extract: knowledge points stored', {
    contentId: ctx.contentId, traceId: ctx.traceId, extracted, stored, blocked,
    windowCount: windows.length, truncated,
  });
  try { await buildGraphStage(ctx); }
  catch (error) { taskLogger.warn('graph-build: persistence unavailable, knowledge extraction continues', {
    contentId: ctx.contentId, traceId: ctx.traceId, code: error instanceof AiError ? error.code : 'UNKNOWN',
  }); }
}

async function extractKnowledgeContext(
  ctx: PipelineStageContext,
  content: { ownerId: string; contentType: string; durationSec: number | null; pageCount: number | null },
  context: StructuredContext,
  mode: 'single' | 'video' | 'document',
): Promise<z.infer<typeof knowledgeExtractionSchema>['points']> {
  const windowed = mode !== 'single';
  const hasSources = validSourceRefs(context.sourceRefs ?? [], context.sourceRefs ?? [], content).length > 0;
  const hasParsedRecords = (context.stats.transcriptCount ?? 0) > 0 || (context.stats.textBlockCount ?? 0) > 0;
  if (windowed && hasParsedRecords && (!hasSources || !context.text.trim())) {
    throw new AiError('当前视频窗口有解析内容，但没有可引用的保留来源，请检查来源或上下文截断。', 'SCHEMA_INVALID', 502);
  }
  if (!context.text.trim()) {
    taskLogger.warn('deep-extract: empty context, skipped', {
      contentId: ctx.contentId,
      traceId: ctx.traceId,
    });
    return [];
  }

  let points: z.infer<typeof knowledgeExtractionSchema>['points'];
  const sources = (context.sourceSegments ?? []).filter((source): boolean =>
    validSourceRefs([source.ref], context.sourceRefs ?? [], content).length > 0 && (mode !== 'document' || !isDocumentNavigation(source.text)))
    .map((source, index): { id: string; ref: ContentRef; text: string } => ({ id: `S${index + 1}`, ...source }));
  if (mode === 'document' && !sources.length) {
    taskLogger.info('deep-extract: navigation-only document batch', { contentId: ctx.contentId, traceId: ctx.traceId });
    return [];
  }
  if (content.contentType === 'VIDEO' && sources.length) {
    sources.sort((a, b): number => (a.ref.type === 'video' ? a.ref.timestampSec : 0) - (b.ref.type === 'video' ? b.ref.timestampSec : 0));
    // 模型偶发整窗弃权（返回空 points，属合法输出，extractJson 不会自动重试）。
    // 这里对弃权最多重试 3 次，仍弃权才按「依据不足」失败——保持原有的保旧语义。
    let data: z.infer<ReturnType<typeof videoSelectionSchema>> | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await extractJson([
        { role: 'system', content: VIDEO_SELECTION_PROMPT },
        { role: 'user', content: JSON.stringify(sources) },
      ], videoSelectionSchema(sources), { timeoutMs: 60_000, traceId: ctx.traceId, temperature: 0.1, maxTokens: 500 });
      data = result.data;
      if (data.points.length) break;
      taskLogger.warn('deep-extract: model abstained on window, retrying selection', {
        contentId: ctx.contentId, traceId: ctx.traceId, attempt, sources: sources.length,
      });
    }
    if (!data || !data.points.length) throw new AiError('本窗没有可精选的完整原文，请先核对转写或OCR；未替换原知识点。', 'INSUFFICIENT_EVIDENCE', 503);
    return data.points.map((point): z.infer<typeof pointSchema> => ({
      ...point,
      refs: validSourceRefs(point.refs, context.sourceRefs, content),
      sourceIds: [],
    }));
  }
  if (content.contentType === 'VIDEO') throw new AiError('视频没有可引用的原文来源，未替换原知识点。', 'INSUFFICIENT_EVIDENCE', 503);
  const sourceById = new Map(sources.map((source): [string, ContentRef] => [source.id, source.ref]));
  if (windowed && !hasSources) return [];
  const resolveRefs = (point: z.infer<typeof pointSchema>): ContentRef[] => validSourceRefs([
    ...(point.refs ?? []),
    ...(point.sourceIds ?? []).flatMap((id): ContentRef[] => { const ref = sourceById.get(id); return ref ? [ref] : []; }),
  ], context.sourceRefs ?? [], content);
  const documentPoint = pointSchema.extend({
    sourceIds: z.array(z.string().min(1).max(20)).min(1).max(20),
    title: z.string().trim().min(2).max(50),
    summary: z.string().trim().min(1).max(1000),
  });
  const documentSchema = z.object({ points: z.array(z.unknown()).min(1).max(3) }).transform((data, validation): { points: z.infer<typeof pointSchema>[]; rejectedPoints: number } => {
    const accepted: z.infer<typeof pointSchema>[] = [];
    for (const candidate of data.points) {
      const parsed = documentPoint.safeParse(candidate);
      if (!parsed.success || parsed.data.sourceIds.some((id): boolean => !sourceById.has(id))
        || !checkContent(`${parsed.data.title}\n${parsed.data.summary}`).safe || resolveRefs(parsed.data).length === 0) continue;
      const evidence = sources.filter((source): boolean => parsed.data.sourceIds.includes(source.id) && documentQuote(source.text, parsed.data.summary) !== null);
      const summary = evidence.length ? documentQuote(evidence[0].text, parsed.data.summary) : null;
      if (!summary || documentTextKey(parsed.data.title).length < 2 || !documentTextKey(summary).includes(documentTextKey(parsed.data.title))) continue;
      accepted.push({ ...parsed.data, summary, sourceIds: evidence.map((source): string => source.id), refs: [] });
    }
    if (!accepted.length) {
      validation.addIssue({ code: z.ZodIssueCode.custom, path: ['points'], message: '本页段无有效原文事实：摘要须逐字取自所选S来源的连续片段且不少于12字，标题须在摘要中；不得扩写或猜来源。' });
      return { points: accepted, rejectedPoints: data.points.length };
    }
    return { points: accepted, rejectedPoints: data.points.length - accepted.length };
  });
  const schema = mode === 'document' ? documentSchema : windowed
    ? knowledgeExtractionSchema.extend({ points: z.array(pointSchema).min(1).max(2) }) : knowledgeExtractionSchema;
  const groundedSchema = schema.superRefine((data, validation): void => {
    data.points.forEach((point, index): void => {
      if (point.sourceIds.some((id): boolean => !sourceById.has(id))) validation.addIssue({
        code: z.ZodIssueCode.custom, path: ['points', index, 'sourceIds'], message: '来源编号不存在，请仅选择提供的S编号。',
      });
    });
    data.points.forEach((point, index): void => {
      if (hasSources && checkContent(`${point.title}\n${point.summary}`).safe && resolveRefs(point).length === 0) validation.addIssue({
        code: z.ZodIssueCode.custom, path: ['points', index, 'sourceIds'], message: '该知识点缺少有效来源；请补实际支持它的S编号，无法找到则删除该知识点。',
      });
    });
    if (windowed && hasSources && !data.points.some((point): boolean => checkContent(`${point.title}\n${point.summary}`).safe && resolveRefs(point).length > 0)) {
      validation.addIssue({ code: z.ZodIssueCode.custom, path: ['points'], message: '本窗口须至少一个安全且有实际引用的知识点。' });
    }
  });
  try {
    const facts = mode === 'document' ? documentFacts(sources) : [];
    if (mode === 'document' && !facts.length) throw new AiError('当前正文缺少可精选的完整原文事实，请补充包含具体定义或结论的资料。', 'SCHEMA_INVALID', 502);
    const extract = mode === 'document' ? <T>(messages: ChatMessage[], targetSchema: z.ZodType<T, z.ZodTypeDef, unknown>, options: ChatOptions): Promise<{ data: T; attempts: number }> =>
      extractDocumentCandidates(messages, targetSchema, options, (text): unknown => parseDocumentFactSelection(text, facts), '事实:F1,F2', 1) : extractJson;
    const { data } = await extract<z.infer<typeof knowledgeExtractionSchema>>(
      [
        { role: 'system', content: mode === 'document' ? DOCUMENT_PROMPT : windowed ? WINDOW_PROMPT : SYSTEM_PROMPT },
        {
          role: 'user',
          content: mode === 'document' ? `以下是本批原文事实，只选择F编号：${JSON.stringify(facts)}` : sources.length > 0
            ? `以下为本次保留的真实来源，只选择支持摘要的编号：${JSON.stringify(sources)}\n学习者笔记（不授权来源）：${JSON.stringify(context.noteTexts ?? [])}`
            : `可引用的来源定位：${JSON.stringify(context.sourceRefs ?? [])}\n学习资料：\n${context.text}`,
        },
      ],
      groundedSchema,
      { timeoutMs: 60_000, traceId: ctx.traceId, temperature: 0.1, maxTokens: 2_500,
        ...(mode === 'document' ? { provider: documentModelProvider() } : {}) },
    );
    points = data.points;
    if (mode === 'document' && 'rejectedPoints' in data) taskLogger.info('deep-extract: document candidates checked', {
      contentId: ctx.contentId, traceId: ctx.traceId, acceptedPoints: points.length, rejectedPoints: data.rejectedPoints,
    });
  } catch (err) {
    taskLogger.warn('deep-extract: extraction failed', {
      contentId: ctx.contentId,
      traceId: ctx.traceId,
      code: err instanceof AiError ? err.code : 'UNKNOWN',
    });
    throw err;
  }

  return points.map((point): z.infer<typeof pointSchema> => ({ ...point, refs: resolveRefs(point), sourceIds: [] }));
}

/** Source whitelist comes from retained evidence metadata, never from model/user prose. */
function validSourceRefs(refs: ContentRef[], sources: ContentRef[], content: { contentType: string; durationSec: number | null; pageCount: number | null }): ContentRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if ((ref.type === 'video' ? 'VIDEO' : 'DOCUMENT') !== content.contentType || !isRefInRange(ref, content)) return false;
    const matches = sources.some((source) => ref.type === 'video'
      ? source.type === 'video' && source.timestampSec === ref.timestampSec
      : source.type === 'document' && source.page === ref.page && (ref.blockIndex === undefined || source.blockIndex === ref.blockIndex));
    const key = JSON.stringify(ref);
    if (!matches || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function registerDeepExtractStage(): void {
  registerPipelineStage('deep-extract', deepExtractStage);
}
