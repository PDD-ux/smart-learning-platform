import { randomUUID } from 'node:crypto';

import { checkContent } from '@/lib/ai/content-guard';
import { chat } from '@/lib/ai/spark';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { buildStructuredContext } from '@/lib/jobs/pipeline/context-builder';
import { createTraceId } from '@/lib/jobs/task-logger';
import { prisma } from '@/lib/prisma';

/**
 * 内容摘要（tasks.md §6.5）
 * ------------------------------------------------------------
 * POST /api/contents/:id/ai/summary
 *   综合解析文本 + 知识点 + 学习者笔记生成摘要，60s 超时。
 *   异常映射：AI_UNAVAILABLE(503) / NO_UNDERSTANDING(409)。
 */

const SYSTEM_PROMPT =
  '你是学习助手。请基于给定的学习资料上下文，生成一段条理清晰的中文摘要，' +
  '覆盖核心概念与要点，便于复习。不要编造上下文之外的信息。';

export const POST = withAuth<{ params: { id: string } }>(async (_request, { user, params }) => {
  const limited = await rateLimit(`ai:summary:${user.id}`, RateLimitPolicy.ai.limit, RateLimitPolicy.ai.windowMs);
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

  const context = await buildStructuredContext(params.id);
  if (!context.text.trim()) {
    return fail(
      ErrorCode.NO_UNDERSTANDING,
      '尚未生成可用的解析内容',
      HttpStatus.CONFLICT,
    );
  }

  const points = await prisma.knowledgePoint.findMany({
    where: { contentId: params.id },
    orderBy: { importance: 'desc' },
    take: 20,
  });
  const pointText = points.map((p) => `- ${p.title}：${p.summary}`).join('\n');

  let summary: string;
  try {
    const result = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `【知识点】\n${pointText || '（无）'}\n\n【上下文】\n${context.text}\n\n请生成摘要。`,
        },
      ],
      { timeoutMs: 60_000, traceId: createTraceId() },
    );
    summary = result.content.trim();
  } catch {
    return fail(ErrorCode.AI_UNAVAILABLE, 'AI 服务暂时不可用，请稍后重试', HttpStatus.SERVICE_UNAVAILABLE);
  }

  if (!summary) {
    return fail(ErrorCode.AI_UNAVAILABLE, 'AI 返回内容为空', HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (!checkContent(summary).safe) {
    return fail(ErrorCode.CONTENT_BLOCKED, '生成内容未通过安全检查', HttpStatus.FORBIDDEN);
  }

  return ok(
    {
      summaryId: randomUUID(),
      summary,
      basedOn: context.stats,
      generatedAt: new Date().toISOString(),
    },
    '摘要已生成',
  );
});
