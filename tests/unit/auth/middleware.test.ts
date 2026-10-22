import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getCurrentUser, withAuth, withOptionalAuth } from '@/lib/auth/middleware';
import { signAccessToken } from '@/lib/auth/jwt';
import { assertOwnership, findForeignResources, ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';

/**
 * 鉴权与归属校验 单测（tasks.md §1.4）
 * ------------------------------------------------------------
 * 覆盖：
 *   - getCurrentUser：正常 / 缺失 / 格式错 / 过期 / 伪造 / role 字段
 *   - withAuth：未登录 → 401；正常 → user 注入；ApiError 自动转 fail
 *   - withOptionalAuth：未登录 → user=null
 *   - assertOwnership：命中 / 不命中 / admin 严格归属 / 缺失参数保护
 */

// happy-dom 没有 NextRequest，用最简 mock
function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new NextRequest('http://localhost/api/test', { headers });
}

describe('getCurrentUser', () => {
  it('returns null when Authorization header is missing', async () => {
    const req = makeRequest();
    expect(await getCurrentUser(req)).toBeNull();
  });

  it('returns null when Authorization header is malformed', async () => {
    const req = makeRequest('NotBearer xxxxxx');
    expect(await getCurrentUser(req)).toBeNull();
  });

  it('returns null when token is forged', async () => {
    const req = makeRequest('Bearer this-is-not-a-real-jwt');
    expect(await getCurrentUser(req)).toBeNull();
  });

  it('returns AuthUser for a valid access token', async () => {
    const token = signAccessToken({ sub: 'usr_001', email: 'a@b.com', role: 'student' });
    const req = makeRequest(`Bearer ${token}`);
    const user = await getCurrentUser(req);
    expect(user).toEqual({ id: 'usr_001', email: 'a@b.com', role: 'student' });
  });

  it('returns null for an expired token', async () => {
    // 强制设置一个过期的 token：手工签发过期 1 秒的
    const jwt = await import('jsonwebtoken');
    const token = jwt.sign(
      { sub: 'usr_001', email: 'a@b.com', role: 'student' },
      process.env.JWT_SECRET!,
      { expiresIn: '-1s' },
    );
    const req = makeRequest(`Bearer ${token}`);
    expect(await getCurrentUser(req)).toBeNull();
  });
});

describe('withAuth', () => {
  it('returns 401 JSON when no Authorization header', async () => {
    const handler = withAuth(async (_req, { user }) => {
      return new Response(JSON.stringify({ userId: user.id }), { status: 200 });
    });
    const res = await handler(makeRequest(), undefined as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: ErrorCode.UNAUTHENTICATED },
    });
  });

  it('injects user into context for valid token', async () => {
    let receivedUser: unknown = null;
    const handler = withAuth(async (_req, { user }) => {
      receivedUser = user;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const token = signAccessToken({ sub: 'usr_002', email: 'b@c.com', role: 'student' });
    const res = await handler(makeRequest(`Bearer ${token}`), undefined as never);
    expect(res.status).toBe(200);
    expect(receivedUser).toEqual({ id: 'usr_002', email: 'b@c.com', role: 'student' });
  });

  it('preserves Next.js dynamic route params (e.g. { params: { id } })', async () => {
    const handler = withAuth<{ params: { id: string } }>(async (_req, { user, params }) => {
      return new Response(JSON.stringify({ userId: user.id, noteId: params.id }), { status: 200 });
    });
    const token = signAccessToken({ sub: 'usr_003', email: 'c@d.com', role: 'student' });
    const res = await handler(
      makeRequest(`Bearer ${token}`),
      { params: { id: 'note_123' } },
    );
    const body = await res.json();
    expect(body).toEqual({ userId: 'usr_003', noteId: 'note_123' });
  });

  it('catches ApiError and converts to fail() with correct status', async () => {
    const handler = withAuth(async () => {
      throw new ApiError(ErrorCode.NOTE_NOT_FOUND, '笔记不存在');
    });
    const token = signAccessToken({ sub: 'usr_004', email: 'd@e.com', role: 'student' });
    const res = await handler(makeRequest(`Bearer ${token}`), undefined as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOTE_NOT_FOUND');
  });

  it('converts unknown errors to 500 without leaking internals', async () => {
    const handler = withAuth(async () => {
      throw new Error('database connection string exposed: postgres://...');
    });
    const token = signAccessToken({ sub: 'usr_005', email: 'e@f.com', role: 'student' });
    const res = await handler(makeRequest(`Bearer ${token}`), undefined as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe('服务器内部错误');
    expect(body.error.message).not.toContain('postgres');
  });
});

describe('withOptionalAuth', () => {
  it('resolves Next16 promised route params before invoking a domain handler', async () => {
    const token = signAccessToken({ sub: 'async-user', email: null, role: 'student' });
    const handler = withAuth<{ params: { id: string } }>(async (_request, { params, user }): Promise<Response> => Response.json({ id: params.id, user: user.id }));
    const response = await handler(makeRequest(`Bearer ${token}`), { params: Promise.resolve({ id: 'owned-content' }) });
    expect(await response.json()).toEqual({ id: 'owned-content', user: 'async-user' });
  });

  it('passes user=null when no token', async () => {
    let receivedUser: unknown = 'NOT_TOUCHED';
    const handler = withOptionalAuth(async (_req, { user }) => {
      receivedUser = user;
      return new Response('ok');
    });
    await handler(makeRequest(), undefined as never);
    expect(receivedUser).toBeNull();
  });

  it('passes real user when token is valid', async () => {
    const token = signAccessToken({ sub: 'usr_006', email: 'f@g.com', role: 'student' });
    let receivedUser: unknown = null;
    const handler = withOptionalAuth(async (_req, { user }) => {
      receivedUser = user;
      return new Response('ok');
    });
    await handler(makeRequest(`Bearer ${token}`), undefined as never);
    expect(receivedUser).toEqual({ id: 'usr_006', email: 'f@g.com', role: 'student' });
  });
});

describe('assertOwnership', () => {
  it('passes when resourceOwnerId === user.id', () => {
    expect(() => assertOwnership('usr_007', { id: 'usr_007' })).not.toThrow();
  });

  it('throws FORBIDDEN when resourceOwnerId !== user.id', () => {
    expect(() => assertOwnership('usr_other', { id: 'usr_007' })).toThrowError(ApiError);
    try {
      assertOwnership('usr_other', { id: 'usr_007' });
    } catch (e) {
      expect((e as ApiError).code).toBe('FORBIDDEN');
      expect((e as ApiError).status).toBe(403);
    }
  });

  it('allows administrators to access their own private resources', () => {
    expect(() =>
      assertOwnership('usr_admin', { id: 'usr_admin', role: 'admin' }),
    ).not.toThrow();
  });

  it('rejects administrators accessing another owner without exposing owner IDs', () => {
    expect(() => assertOwnership('usr_other', { id: 'usr_admin', role: 'admin' }))
      .toThrowError(expect.objectContaining({ code: ErrorCode.FORBIDDEN, status: 403, details: undefined }));
  });

  it.each(['student', 'admin'])('checks every resource for %s batches', (role) => {
    expect(findForeignResources([
      { id: 'own', ownerId: 'usr_007' },
      { id: 'foreign', ownerId: 'usr_other' },
      { id: 'missing-owner', ownerId: '' },
    ], { id: 'usr_007', role })).toEqual(['foreign', 'missing-owner']);
  });

  it('rejects missing user IDs even for empty administrator batches', () => {
    expect(() => findForeignResources([], { id: '', role: 'admin' }))
      .toThrowError(expect.objectContaining({ code: ErrorCode.INTERNAL }));
  });

  it('throws INTERNAL when resourceOwnerId is empty', () => {
    expect(() => assertOwnership('', { id: 'usr_007' })).toThrowError(ApiError);
  });

  it('throws INTERNAL when user.id is missing', () => {
    expect(() =>
      assertOwnership('usr_007', { id: '' }),
    ).toThrowError(ApiError);
  });
});

describe('ApiError', () => {
  it('derives HTTP status from ErrorHttpStatus', () => {
    const err401 = new ApiError(ErrorCode.UNAUTHENTICATED, '请先登录');
    expect(err401.status).toBe(401);
    const err403 = new ApiError(ErrorCode.FORBIDDEN, '禁止访问');
    expect(err403.status).toBe(403);
    const err404 = new ApiError(ErrorCode.NOTE_NOT_FOUND, '笔记不存在');
    expect(err404.status).toBe(404);
  });

  it('falls back to 500 for unknown error codes', () => {
    const err = new ApiError('UNKNOWN_CODE', '未知错误');
    expect(err.status).toBe(500);
  });
});
