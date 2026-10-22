import { NextRequest, NextResponse } from 'next/server';
import { fail, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { parseBearer, type TokenPayload } from './jwt';
import { ApiError } from './ownership';

/**
 * 鉴权中间件（API Route 用）
 * ------------------------------------------------------------
 * 任务来源：tasks.md §1.4
 *
 * 提供三个能力：
 *   1. getCurrentUser(request) —— 从 Authorization: Bearer 解析当前用户，无 / 失效返回 null
 *   2. withAuth(handler)        —— 包装 API Route handler，自动注入 user；
 *                                 未登录返回 401 JSON；
 *                                 handler 抛 ApiError 时自动转 fail() 响应
 *   3. withOptionalAuth(handler) —— 同上但允许匿名访问（user 可能为 null）
 *
 * 设计原则：
 *   - 解析失败 = 静默返回 null（不抛异常），让调用方决定行为（部分接口允许匿名）
 *   - 用 HOC 而非 Next.js middleware.ts：因为 Next.js middleware 跑在 Edge Runtime，
 *     而 bcrypt / prisma 只能在 Node 运行时；用 HOC 包装 handler 更可靠
 *   - 与资源归属校验解耦（见 ./ownership.ts），鉴权只负责"你是谁"，不负责"你能访问哪个资源"
 */

export type AuthUser = {
  id: string;
  email: string | null;
  role: string;
};

/**
 * 从 Authorization 头解析当前用户
 * @returns 成功返回 AuthUser；缺失 / 格式错 / 过期 / 伪造 一律返回 null
 */
export async function getCurrentUser(request: NextRequest): Promise<AuthUser | null> {
  // 同时支持 Authorization: Bearer（前端持有）与 httpOnly access_token Cookie（防御纵深，
  // 为后续将令牌移出前端存储、改用 Cookie 承载预留兼容通道）。
  const headerToken = request.headers.get('authorization') ?? undefined;
  const cookieToken = request.cookies.get('access_token')?.value;
  const payload: TokenPayload | null = parseBearer(headerToken ?? (cookieToken ? `Bearer ${cookieToken}` : null));
  if (!payload?.sub) return null;
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };
}

/**
 * API Route handler 的上下文：在 Next.js 默认 context 基础上追加 user 字段
 */
export type AuthedContext<P = unknown> = P & { user: AuthUser };

/**
 * API Route handler 鉴权后的形态：第二个参数固定包含 user
 */
export type AuthedHandler<P = unknown> = (
  request: NextRequest,
  context: AuthedContext<P>,
) => Promise<Response> | Response;

/**
 * 原始 handler 形态（Next.js App Router 标准签名）
 * 返回 Response 而非 NextResponse：NextResponse 继承自 Response，
 * 放宽后 handler 可返回标准 Response（便于单测），Next.js 同样接受。
 */
type NextContext<P> = P extends { params: infer Params }
  ? Omit<P, 'params'> & { params: Promise<Params> }
  : { params: Promise<Record<string, string | string[] | undefined>> };

export type RouteHandler<P = unknown> = {
  (request: NextRequest, context?: P | NextContext<P>): Promise<Response> | Response;
  (request: NextRequest, context: NextContext<P>): Promise<Response> | Response;
};

/** Resolve Next16 params at the boundary; domain handlers keep plain validated identifiers. */
async function resolveContext<P>(context: P | NextContext<P> | undefined): Promise<P> {
  if (context && typeof context === 'object' && 'params' in context) {
    return { ...context, params: await context.params } as P;
  }
  return (context ?? {}) as P;
}

/**
 * 鉴权 HOC：自动从请求解析用户，未登录直接返回 401 JSON；登录后把 user 注入 context
 *
 * 用法：
 *   // 普通用法
 *   export const POST = withAuth(async (req, { user }) => {
 *     return ok({ userId: user.id }, '操作成功');
 *   });
 *
 *   // 带动态路由参数（Next.js 风格）
 *   export const DELETE = withAuth<{ params: { id: string } }>(async (req, { user, params }) => {
 *     await assertOwnership(params.id /* 真实 ownerId *\/, user.id);
 *     return ok({ deleted: true });
 *   });
 */
export function withAuth<P = Record<string, never>>(handler: AuthedHandler<P>): RouteHandler<P> {
  return async (request, context) => {
    const user = await getCurrentUser(request);
    if (!user) {
      return fail(
        ErrorCode.UNAUTHENTICATED,
        '请先登录',
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      return await handler(request, { ...await resolveContext<P>(context), user });
    } catch (err) {
      return handleApiError(err);
    }
  };
}

/**
 * 可选鉴权：解析用户但不强制登录；适用于"登录后体验更好"的接口（如学习进度上报）
 * 解析失败时 user = null，handler 自行决定是否降级
 */
export function withOptionalAuth<P = Record<string, never>>(
  handler: (request: NextRequest, context: P & { user: AuthUser | null }) => Promise<Response> | Response,
): RouteHandler<P> {
  return async (request, context) => {
    const user = await getCurrentUser(request);
    try {
      return await handler(request, { ...await resolveContext<P>(context), user });
    } catch (err) {
      return handleApiError(err);
    }
  };
}

/**
 * 统一错误转换：ApiError → fail()；未知错误 → 500 且不暴露内部信息
 */
function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return fail(err.code, err.message, err.status, err.details);
  }
  // 未知错误：记录到服务端日志，但不暴露给前端
  // eslint-disable-next-line no-console
  console.error('[api unhandled]', { code: ErrorCode.INTERNAL });
  return fail(
    ErrorCode.INTERNAL,
    '服务器内部错误',
    HttpStatus.INTERNAL,
  );
}
