import { NextRequest, type NextResponse } from 'next/server';
import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { getClientIp, rateLimit } from '@/lib/api/rate-limit';
import { accessTtlSec, signAccessToken, verifyRefreshToken, type RefreshPayload } from '@/lib/auth/jwt';
import { attachAccessCookie, clearAuthCookies, passwordVersion, REFRESH_COOKIE, toPublicUser } from '@/lib/auth/session';
import { isSessionRequest } from '@/lib/auth/same-origin';
import { prisma } from '@/lib/prisma';

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function expired(): NextResponse {
  const response = fail(ErrorCode.UNAUTHENTICATED, '登录已失效，请重新登录。', HttpStatus.UNAUTHORIZED);
  clearAuthCookies(response);
  return noStore(response);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSessionRequest(request)) return noStore(fail(ErrorCode.FORBIDDEN, '请求来源无效。', HttpStatus.FORBIDDEN));
  const limited = await rateLimit(`session-refresh:${getClientIp(request)}`, 30, 60_000);
  if (!limited.allowed) {
    const response = noStore(fail(ErrorCode.RATE_LIMITED, '登录续期过于频繁，请稍后重试。', HttpStatus.TOO_MANY_REQUESTS));
    response.headers.set('Retry-After', String(limited.retryAfter));
    return response;
  }
  let payload: RefreshPayload;
  try { payload = verifyRefreshToken(request.cookies.get(REFRESH_COOKIE)?.value ?? ''); }
  catch { return expired(); }
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, phone: true, nickname: true, role: true, passwordHash: true } });
    if (!user || !['student', 'teacher', 'admin'].includes(user.role) || passwordVersion(user.passwordHash) !== payload.credentialVersion) return expired();
    const remaining = payload.exp - Math.floor(Date.now() / 1_000);
    if (remaining <= 0) return expired();
    const expiresInSec = Math.min(accessTtlSec(), remaining);
    const publicUser = toPublicUser(user);
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role }, expiresInSec);
    const response = noStore(ok({ user: publicUser, accessToken, expiresInSec }, '登录已续期'));
    attachAccessCookie(response, accessToken, expiresInSec);
    return response;
  } catch {
    return noStore(fail(ErrorCode.INTERNAL, '登录续期暂不可用，请稍后重试。', HttpStatus.SERVICE_UNAVAILABLE));
  }
}
