import type { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { signAccessToken, signRefreshToken, accessTtlSec, refreshTtlSec, type TokenPayload } from './jwt';

/**
 * 会话签发与 Cookie 管理（tasks.md §1.4）
 * ------------------------------------------------------------
 * 统一登录 / 注册 / 登出的令牌签发与 Cookie 下发，避免各路由重复实现。
 *
 * 约定：
 *   - access token 15min（JWT_ACCESS_TTL）：随响应体返回（前端 Bearer 调用）+ httpOnly Cookie；
 *   - refresh token 30d（JWT_REFRESH_TTL）：仅 httpOnly Cookie，绝不写入响应体（降低 XSS 暴露面）；
 *   - refresh 固定原登录期限；续期只更新 access，不轮换 refresh（§22.1）。
 */

export type SessionUser = {
  id: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  role: string;
};

/** 对外返回的用户信息（不含 passwordHash 等敏感字段） */
export type PublicUser = SessionUser;

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

export function toPublicUser(user: {
  id: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  role: string;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    nickname: user.nickname,
    role: user.role,
  };
}

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
};

/** 私有密码版本摘要，仅写入 HttpOnly 刷新令牌，不进入公开用户信息。 */
export function passwordVersion(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex');
}

/** 为指定用户签发固定登录期限的 access / refresh 令牌。 */
export function issueSession(user: PublicUser, credentialVersion: string, remember = false): IssuedSession {
  const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role };
  const refreshLifetime = remember ? refreshTtlSec() : Math.min(7_200, refreshTtlSec());
  return {
    accessToken: signAccessToken(payload, Math.min(accessTtlSec(), refreshLifetime)),
    refreshToken: signRefreshToken(payload, credentialVersion, refreshLifetime),
  };
}

function cookieBase(): { httpOnly: boolean; sameSite: 'lax'; path: string; secure: boolean } {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
}

export function attachAccessCookie(response: NextResponse, token: string, lifetimeSec: number): void {
  response.cookies.set(ACCESS_COOKIE, token, { ...cookieBase(), maxAge: lifetimeSec });
}

/**
 * 下发鉴权 Cookie
 * @param remember 「记住我」为 true 时 refresh Cookie 用完整 30 天，否则仅 2 小时
 */
export function attachAuthCookies(
  response: NextResponse,
  session: IssuedSession,
  remember: boolean,
): void {
  const base = cookieBase();
  const refreshLifetime = remember ? refreshTtlSec() : Math.min(7_200, refreshTtlSec());
  attachAccessCookie(response, session.accessToken, Math.min(accessTtlSec(), refreshLifetime));
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    ...base,
    maxAge: refreshLifetime,
  });
}

/** 清除鉴权 Cookie（登出） */
export function clearAuthCookies(response: NextResponse): void {
  const base = cookieBase();
  response.cookies.set(ACCESS_COOKIE, '', { ...base, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { ...base, maxAge: 0 });
}
