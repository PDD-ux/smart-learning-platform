import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { checkContent } from '@/lib/ai/content-guard';
import { AiError, extractJson } from '@/lib/ai/spark';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { isRefInRange } from '@/lib/domain/content-ref';
import { selectQaSources } from '@/lib/domain/qa-sources';
import { buildStructuredContext } from '@/lib/jobs/pipeline/context-builder';
import { createTraceId, taskLogger } from '@/lib/jobs/task-logger';
import { prisma } from '@/lib/prisma';

/**
 * 基于内容的知识问答（tasks.md §6.5）
 * ------------------------------------------------------------
 * POST /api/contents/:id/ai/qa
 *   仅限本内容上下文（禁止发散），30s 超时，回答携带 citations。
 *   异常映射：AI_UNAVAILABLE(503) / NO_UNDERSTANDING(409) / QUESTION_EMPTY(400)。
 */

const bodySchema = z.object({
  question: z.string().max(500, '问题最多 500 字'),
});

const qaSchema = z.object({
  answer: z.string().min(1).max(4000).refine((value) => value.trim() !== '依据资料的回答', 'answer 不能照抄格式示例占位文字，必须实际回答用户问题'),
  sourceIds: z.array(z.number().int().min(1)).max(10),
});

const SYSTEM_PROMPT =
  '你是学习助手，仅依据资料回答当前问题，不补充无关结论。' +
  '只输出合法 JSON，字段 answer 为实际回答，sourceIds 为支持回答的资料 id 整数数组（最多 10 个）。' +
  '不要返回时间或摘录。资料不足时说明不足并给空数组；笔记不能作为引用。';

export const POST = withAuth<{ params: { id: string } }>(async (request, { user, params }) => {
  const limited = await rateLimit(`ai:qa:${user.id}`, RateLimitPolicy.ai.limit, RateLimitPolicy.ai.windowMs);
  if (!limited.allowed) {
    const response = fail(ErrorCode.RATE_LIMITED, 'AI 请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, { retryAfter: limited.retryAfter });
    response.headers.set('Retry-After', String(limited.retryAfter));
    return response;
  }

  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) {
    return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
  assertOwnership(content.ownerId, user);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }
  const question = parsed.data.question.trim();
  if (!question) {
    return fail(ErrorCode.QUESTION_EMPTY, '问题不能为空', HttpStatus.BAD_REQUEST);
  }

  const context = await buildStructuredContext(params.id);
  if (!context.text.trim()) {
    return fail(ErrorCode.NO_UNDERSTANDING, '尚未生成可用的解析内容', HttpStatus.CONFLICT);
  }

  let qa: z.infer<typeof qaSchema>;
  const traceId = createTraceId();
  const bounds = {
    contentType: content.contentType === 'VIDEO' ? 'video' as const : 'document' as const,
    durationSec: content.durationSec,
    pageCount: content.pageCount,
  };
  const sources = selectQaSources((context.sourceSegments ?? []).filter((source) => source.ref.type === bounds.contentType && isRefInRange(source.ref, bounds) && source.text.trim()), question);
  const groundedSchema = qaSchema.superRefine((value, ctx): void => {
    if (value.sourceIds.some((id) => id > sources.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceIds'], message: '来源编号必须是输入资料中存在的 id。' });
    }
  });
  try {
    const { data } = await extractJson<z.infer<typeof qaSchema>>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `【资料连续阅读文本，帮助理解转写断句；引用仍选下方编号】\n${sources.map((source) => source.text).join('\n').slice(0, 3000)}\n\n【资料来源】\n${JSON.stringify(sources.map((source, index) => ({ id: index + 1, text: source.text })))}\n\n【学习者笔记：不作为引用出处】\n${JSON.stringify(context.noteTexts ?? [])}\n\n【问题】\n${question}` },
      ],
      groundedSchema,
      { timeoutMs: 30_000, traceId, temperature: 0.1 },
    );
    qa = data;
  } catch (error) {
    taskLogger.warn('qa: AI request failed', {
      contentId: params.id,
      traceId,
      code: error instanceof AiError ? error.code : 'UNKNOWN',
    });
    return fail(ErrorCode.AI_UNAVAILABLE, 'AI 服务暂时不可用，请稍后重试', HttpStatus.SERVICE_UNAVAILABLE);
  }

  const citations = [...new Set(qa.sourceIds)].map((id) => ({ ref: sources[id - 1].ref, excerpt: sources[id - 1].text.trim().slice(0, 500) }));
  if (!checkContent(qa.answer).safe || citations.some((citation) => !checkContent(citation.excerpt).safe)) {
    return fail(ErrorCode.CONTENT_BLOCKED, '生成内容未通过安全检查', HttpStatus.FORBIDDEN);
  }

  return ok(
    {
      qaId: randomUUID(),
      answer: qa.answer,
      citations,
      createdAt: new Date().toISOString(),
    },
    '已生成回答',
  );
});
