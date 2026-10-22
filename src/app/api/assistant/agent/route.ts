import { agentRequestSchema } from '@/lib/agent/contracts';
import { runLearningAgent } from '@/lib/agent/learning-agent';
import { checkContent } from '@/lib/ai/content-guard';
import { AiError } from '@/lib/ai/spark';
import { describeAiFailure } from '@/lib/ai/failure-message';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { taskLogger } from '@/lib/jobs/task-logger';

export const POST = withAuth(async (request, { user }): Promise<Response> => {
  const parsed = agentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '请检查资料、学习目标和时间预算', HttpStatus.BAD_REQUEST);
  if ([parsed.data.message, ...parsed.data.history.map((item) => item.content)].some((value) => !checkContent(value).safe)) return fail(ErrorCode.CONTENT_BLOCKED, '学习目标未通过安全检查，请换个问法', HttpStatus.FORBIDDEN);
  const limited = await rateLimit(`ai:agent:${user.id}`, RateLimitPolicy.ai.limit, RateLimitPolicy.ai.windowMs);
  if (!limited.allowed) {
    const response = fail(ErrorCode.RATE_LIMITED, 'AI请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, { retryAfter: limited.retryAfter });
    response.headers.set('Retry-After', String(limited.retryAfter)); return response;
  }
  try { return ok(await runLearningAgent(parsed.data, user.id), '学习任务已分析'); }
  catch (reason: unknown) {
    if (!(reason instanceof AiError)) throw reason;
    taskLogger.warn('agent: model request failed', { code: reason.code, contentId: parsed.data.contentId });
    // 错误码随 details 返回，便于在浏览器网络面板定位；页面只展示 describeAiFailure 的固定文案。
    return fail(ErrorCode.AI_UNAVAILABLE, describeAiFailure(reason, '；没有保存计划或提交答案'), HttpStatus.SERVICE_UNAVAILABLE, { reason: reason.code });
  }
});
