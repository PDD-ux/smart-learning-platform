import type { NextRequest } from 'next/server';
import { ok, fail, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { clearAuthCookies } from '@/lib/auth/session';
import { isSessionRequest } from '@/lib/auth/same-origin';

/**
 * 登出接口（spec/04-DATA-MODEL.md §5.9）
 * ------------------------------------------------------------
 * 同源请求幂等清除 access / refresh Cookie；access 过期仍能退出。
 * 无状态 JWT 服务端不维护会话，前端同时丢弃本地 token 即可。
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSessionRequest(request)) return fail(ErrorCode.FORBIDDEN, '请求来源无效。', HttpStatus.FORBIDDEN);
  const response = ok({ loggedOut: true }, '已退出登录');
  clearAuthCookies(response);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
