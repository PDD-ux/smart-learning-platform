import { z } from 'zod';

import { checkContent } from '@/lib/ai/content-guard';
import { AiError, extractJson } from '@/lib/ai/spark';
import { prisma } from '@/lib/prisma';
import { taskLogger } from '@/lib/jobs/task-logger';
import { generateStructuredNote } from '@/lib/domain/generated-note';
import { documentTextKey, documentQuote } from './document-quality';
import { contentRefSchema } from '@/lib/domain/content-ref';

import { registerPipelineStage, type PipelineStageContext } from './understanding-pipeline';

/**
 * PRODUCT_GEN：闪卡生成（tasks.md §6.4）
 * ------------------------------------------------------------
 * 视频按知识点生成问答；文档核对实际页/原文后构造原文回忆卡，不额外调用模型。
 * `{front, back, hint}` 经 zod 强校验及输出侧 `checkContent` 过滤
 * → 入库 `Flashcard`（status=new）。
 * 幂等：重跑先删该内容既有闪卡再整批写入；可与知识点抽取独立重试/失败。
 * 必需阶段：无知识点、文档原文不符、视频模型失败或无可用卡片时抛错。
 */

const cardSchema = z.object({
  pointIndex: z.number().int().min(0),
  front: z.string().trim().min(1).max(100).refine(
    (front: string): boolean => /[？?]$/.test(front),
    '正面必须是以问号结尾的简短问题',
  ),
  back: z.string().trim().min(1).max(700),
  hint: z.string().max(500).optional(),
}).refine(
  (card): boolean => card.front !== card.back,
  { message: '答案不能与问题相同', path: ['back'] },
);

export const flashcardGenerationSchema = z.preprocess(
  (value: unknown): unknown => Array.isArray(value) ? { cards: value } : value,
  z.object({ cards: z.array(cardSchema).min(1).max(50) }),
);

const SYSTEM_PROMPT =
  '你是学习助手。请把每个知识点改写为一张可自测的问答闪卡，每张只考一个核心事实。' +
  '问题必须具体、以问号结尾，不超过50字；答案仅依据知识点，不超过120字，不复述问题或编造事实。' +
  '只返回一个合法的二维JSON数组，按输入顺序每个知识点恰好一行，每行恰好两个字符串：[问题,答案]。' +
  '例如两个知识点的格式为：[["第一个知识点的核心是什么？","第一个知识点的简短答案。"],["第二个知识点的核心是什么？","第二个知识点的简短答案。"]]。' +
  '不要对象、字段名、序号、提示、Markdown或数组外文字；不要复制代码或多行文本，字符串中的双引号须转义。';

export async function productGenStage(ctx: PipelineStageContext): Promise<void> {
  const content = await prisma.learningContent.findUnique({
    where: { id: ctx.contentId },
    select: { ownerId: true, contentType: true, format: true },
  });
  if (!content) {
    throw new Error(`content not found: ${ctx.contentId}`);
  }
  const document = content.contentType === 'DOCUMENT' && ['PDF', 'MD', 'TXT'].includes(content.format);

  const points = await prisma.knowledgePoint.findMany({
    where: { contentId: ctx.contentId },
    orderBy: { createdAt: 'asc' },
  });
  if (points.length === 0) {
    taskLogger.warn('product-gen: no knowledge points, generation failed', {
      contentId: ctx.contentId,
      traceId: ctx.traceId,
    });
    throw new AiError('没有可用知识点，无法生成复习产物，请检查解析与模型后重试。', 'SCHEMA_INVALID', 502);
  }

  const cards: z.infer<typeof flashcardGenerationSchema>['cards'] = [];
  try {
    if (document) {
      const sources = await prisma.textBlock.findMany({ where: { contentId: ctx.contentId }, select: { ref: true, text: true } });
      for (const [pointIndex, point] of points.entries()) {
        const refs = z.array(contentRefSchema).safeParse(point.refs);
        const source = sources.find((candidate): boolean => {
          const ref = contentRefSchema.safeParse(candidate.ref);
          return ref.success && ref.data.type === 'document' && refs.success && refs.data.some((item): boolean =>
            item.type === 'document' && ref.data.type === 'document' && item.page === ref.data.page && (item.blockIndex === undefined || item.blockIndex === ref.data.blockIndex))
            && documentQuote(candidate.text, point.summary) !== null;
        });
        const back = source ? documentQuote(source.text, point.summary) : null;
        if (!back || back.length > 700 || documentTextKey(point.title).length < 2 || !documentTextKey(back).includes(documentTextKey(point.title))) {
          throw new AiError('文档知识点缺少与引用一致的原文事实，请重新解析；未替换旧复习产物。', 'SCHEMA_INVALID', 502);
        }
        const card = cardSchema.parse({ pointIndex, front: `原文中，${point.title}对应的事实是什么？`, back });
        cards.push(card);
      }
    }
    for (let offset = 0; !document && offset < points.length; offset += 8) {
      const batch = points.slice(offset, offset + 8);
      const list = batch.map((point, index): string => `${index}. ${point.title}：${point.summary}`).join('\n');
      const indexedSchema = flashcardGenerationSchema.superRefine((data, validation): void => {
        const seen = new Set<number>();
        for (const card of data.cards) {
          if (card.pointIndex >= batch.length || seen.has(card.pointIndex)) validation.addIssue({
            code: z.ZodIssueCode.custom, path: ['cards'], message: 'pointIndex必须属于本批且不得重复。',
          });
          seen.add(card.pointIndex);
        }
      });
      const batchSchema = z.preprocess((value: unknown, validation): unknown => {
        if (!Array.isArray(value) || value.every((row): boolean => typeof row === 'object' && row !== null && !Array.isArray(row))) return value;
        const ordered = z.array(z.tuple([z.string(), z.string()])).length(batch.length).safeParse(value);
        if (!ordered.success) {
          validation.addIssue({ code: z.ZodIssueCode.custom, message: '必须按输入顺序返回等量的[问题,答案]行，每行恰好两个字符串。' });
          return z.NEVER;
        }
        return { cards: ordered.data.map(([front, back], pointIndex): { pointIndex: number; front: string; back: string } => ({ pointIndex, front, back })) };
      }, indexedSchema);
      const { data } = await extractJson<z.infer<typeof flashcardGenerationSchema>>(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `按顺序为以下${batch.length}个知识点生成${batch.length}行[问题,答案]。必须保留外层数组，即使只有一个知识点也返回[["问题？","答案"]]。格式示例：${JSON.stringify(batch.map((_point, index): [string, string] => [`第${index + 1}个核心是什么？`, '对应的简短答案']))}\n${list}` },
        ],
        batchSchema,
        { timeoutMs: 60_000, traceId: ctx.traceId, temperature: 0.1, maxTokens: 2_000 },
      );
      cards.push(...data.cards.map((card): z.infer<typeof flashcardGenerationSchema>['cards'][number] => {
        return { ...card, pointIndex: card.pointIndex + offset };
      }));
    }
  } catch (err) {
    taskLogger.warn('product-gen: flashcard generation failed', {
      contentId: ctx.contentId,
      traceId: ctx.traceId,
      code: err instanceof AiError ? err.code : 'UNKNOWN',
    });
    throw err;
  }

  const accepted = cards.filter((card): boolean => Boolean(points[card.pointIndex]) && checkContent(`${card.front}\n${card.back}`).safe);
  if (document && new Set(accepted.map((card): string => documentTextKey(card.front))).size !== accepted.length) {
    throw new AiError('文档复习问题重复，未替换旧复习产物。', 'SCHEMA_INVALID', 502);
  }
  if (accepted.length === 0) throw new AiError('闪卡未通过内容校验，未替换原复习产物。', 'SCHEMA_INVALID', 502);
  await generateStructuredNote(ctx.contentId);
  let stored = 0;
  const blocked = cards.length - accepted.length;
  await prisma.$transaction(async (tx): Promise<void> => {
    await tx.flashcard.deleteMany({ where: { contentId: ctx.contentId } });
    for (const card of accepted) {
      const point = points[card.pointIndex];
      if (!point) continue;
      await tx.flashcard.create({
        data: {
          contentId: ctx.contentId,
          ownerId: content.ownerId,
          pointId: point.id,
          cardType: 'QA',
          front: card.front,
          back: card.back,
          hint: card.hint ?? null,
          status: 'NEW',
        },
      });
      stored += 1;
    }
  });

  taskLogger.info('product-gen: flashcards stored', {
    contentId: ctx.contentId,
    traceId: ctx.traceId,
    generated: cards.length,
    stored,
    blocked,
  });
}

export function registerProductGenStage(): void {
  registerPipelineStage('product-gen', productGenStage);
}
