import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth, type AuthedHandler, type RouteHandler } from '@/lib/auth/middleware';
import { privateResponse } from '@/lib/api/private-response';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { classBody } from '@/lib/classrooms/routes';
import { commandHomeworkGradingReport, createHomeworkGradingReport, listHomeworkGradingReports, listHomeworkMistakes, runHomeworkGradingReport } from './grading-service';

type DraftParams = { params: { id: string } };
type ReportParams = { params: { id: string; reportId: string } };
function wrap<P>(handler: AuthedHandler<P>): RouteHandler<P> {
  const auth = withAuth(handler);
  return async (request, context): Promise<Response> => privateResponse((): Promise<Response> | Response => auth(request, context))();
}
function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new ApiError(ErrorCode.NOT_FOUND, '作业批改报告不存在或不可访问');
  }
  return value;
}
async function aiLimited(actorId: string): Promise<void> {
  if (!(await rateLimit(`homework-grading:${actorId}`, 3, 60_000)).allowed) throw new ApiError(ErrorCode.RATE_LIMITED, '批改请求频繁，请稍后重试');
}

export function homeworkGradingHandlers(db: PrismaClient = prisma): {
  LIST: RouteHandler<DraftParams>;
  CREATE: RouteHandler<DraftParams>;
  RUN: RouteHandler<ReportParams>;
  COMMAND: RouteHandler<ReportParams>;
  MISTAKES: RouteHandler;
} {
  return {
    LIST: wrap<DraftParams>(async (_request, { user, params }): Promise<Response> => ok(await listHomeworkGradingReports(user.id, uuid(params.id), db))),
    CREATE: wrap<DraftParams>(async (request, { user, params }): Promise<Response> => ok(await createHomeworkGradingReport(user.id, uuid(params.id), await classBody(request, 32 * 1024), db))),
    RUN: wrap<ReportParams>(async (request, { user, params }): Promise<Response> => {
      await aiLimited(user.id);
      return ok(await runHomeworkGradingReport(user.id, uuid(params.id), uuid(params.reportId), request.signal, db));
    }),
    COMMAND: wrap<ReportParams>(async (request, { user, params }): Promise<Response> => {
      const draftId = uuid(params.id);
      const reportId = uuid(params.reportId);
      const body = await classBody(request, 32 * 1024);
      if (typeof body === 'object' && body !== null && 'action' in body && body.action === 'correct') await aiLimited(user.id);
      return ok(await commandHomeworkGradingReport(user.id, draftId, reportId, body, request.signal, db));
    }),
    MISTAKES: wrap(async (_request, { user }): Promise<Response> => ok(await listHomeworkMistakes(user.id, db))),
  };
}
