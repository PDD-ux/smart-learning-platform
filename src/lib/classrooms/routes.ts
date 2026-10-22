import type { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { withAuth, type AuthedHandler, type RouteHandler } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { privateResponse } from '@/lib/api/private-response';
import { getClientIp, rateLimit } from '@/lib/api/rate-limit';
import { prisma } from '@/lib/prisma';
import { classId } from './contracts';
import { createClass, joinClass, commandClass, listClasses, readClass, classSources } from './service';
function route<P>(handler: AuthedHandler<P>): RouteHandler<P> { const authenticated = withAuth(handler); return async (request, context): Promise<Response> => privateResponse((): Response | Promise<Response> => authenticated(request, context))(); }
export function classPage(request: NextRequest): number {
  const query = request.nextUrl.searchParams;
  if ([...query.keys()].some((key): boolean => key !== 'page') || query.getAll('page').length > 1 || (query.has('page') && !/^[1-9][0-9]{0,3}$/u.test(query.get('page') ?? ''))) throw new ApiError(ErrorCode.VALIDATION_FAILED, '分页参数不合法');
  return Number(query.get('page') ?? 1);
}
export async function classBody(request: NextRequest, maxBytes = 128 * 1024): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(ErrorCode.VALIDATION_FAILED, '请使用JSON请求');
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(ErrorCode.INVALID_JSON, '缺少请求正文');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new ApiError(ErrorCode.VALIDATION_FAILED, '请求正文大小超过上限'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (reason) { if (reason instanceof ApiError) throw reason; throw new ApiError(ErrorCode.INVALID_JSON, '请求JSON不合法'); }
  finally { reader.releaseLock(); }
}
function id(value: string): string { const result = classId.safeParse(value); if (!result.success) throw new ApiError(ErrorCode.NOT_FOUND, '班级资源不存在或不可访问'); return result.data; }
async function limit(request: NextRequest, actorId: string, join = false): Promise<void> {
  const results = await Promise.all([rateLimit('classes:user:' + actorId + (join ? ':join' : ':write'), join ? 5 : 40, 60000), ...(join ? [rateLimit('classes:ip:join:' + getClientIp(request), 5, 60000)] : [])]);
  if (results.some((result): boolean => !result.allowed)) throw new ApiError(ErrorCode.RATE_LIMITED, '操作过于频繁，请一分钟后重试');
}
export function classHandlers(db: PrismaClient = prisma): { GET: RouteHandler; POST: RouteHandler; JOIN: RouteHandler; READ: RouteHandler<{ params: { id: string } }>; COMMAND: RouteHandler<{ params: { id: string } }>; SOURCES: RouteHandler<{ params: { id: string } }> } {
  return {
    GET: route(async (req, { user }): Promise<Response> => ok(await listClasses(user.id, classPage(req), db))),
    POST: route(async (req, { user }): Promise<Response> => { await limit(req, user.id); return ok(await createClass(user.id, await classBody(req), db)); }),
    JOIN: route(async (req, { user }): Promise<Response> => { await limit(req, user.id, true); return ok(await joinClass(user.id, await classBody(req), db)); }),
    READ: route<{ params: { id: string } }>(async (_req, { user, params }): Promise<Response> => ok(await readClass(user.id, id(params.id), db))),
    COMMAND: route<{ params: { id: string } }>(async (req, { user, params }): Promise<Response> => { await limit(req, user.id); return ok(await commandClass(user.id, id(params.id), await classBody(req), db)); }),
    SOURCES: route<{ params: { id: string } }>(async (req, { user, params }): Promise<Response> => ok(await classSources(user.id, id(params.id), classPage(req), db))),
  };
}



