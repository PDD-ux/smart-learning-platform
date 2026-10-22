// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { signAccessToken, signRefreshToken, verifyToken, parseBearer, verifyRefreshToken } from '@/lib/auth/jwt';
import { issueSession, passwordVersion } from '@/lib/auth/session';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), rateLimit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/api/rate-limit', () => ({ rateLimit: mocks.rateLimit, getClientIp: (): string => '127.0.0.1' }));
import { POST as refresh } from '@/app/api/auth/refresh/route';
import { POST as logout } from '@/app/api/auth/logout/route';

const user = { id: 'u1', email: 'test@example.com', phone: null, nickname: '学习者', role: 'student', passwordHash: 'test-password-hash' };
function request(token?: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/refresh', { method: 'POST', headers: { origin: 'http://localhost', 'x-session-refresh': '1', ...(token ? { cookie: `refresh_token=${token}` } : {}), ...headers } });
}
function refreshToken(seconds = 7_200): string { return signRefreshToken({ sub: user.id, email: user.email, role: user.role }, passwordVersion(user.passwordHash), seconds); }
beforeEach((): void => { vi.clearAllMocks(); mocks.findUnique.mockResolvedValue(user); mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfter: 0 }); });

it('renews from the HttpOnly refresh cookie, reads current role, and never rotates refresh', async (): Promise<void> => {
  mocks.findUnique.mockResolvedValue({ ...user, role: 'admin' });
  const token = refreshToken();
  const response = await refresh(request(token));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.user.role).toBe('admin');
  expect(verifyToken(body.data.accessToken)).toMatchObject({ sub: user.id, role: 'admin', tokenUse: 'access' });
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).not.toContain('refresh_token');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(JSON.stringify(body)).not.toContain('credentialVersion');
  expect(JSON.stringify(body)).not.toContain(user.passwordHash);
});
it('accepts a teacher refresh token and signs the current database role', async (): Promise<void> => {
  const teacher = { ...user, role: 'teacher' };
  mocks.findUnique.mockResolvedValue(teacher);
  const token = signRefreshToken({ sub: teacher.id, email: teacher.email, role: teacher.role }, passwordVersion(teacher.passwordHash), 7_200);
  const response = await refresh(request(token));
  expect(response.status).toBe(200);
  expect((await response.json()).data.user.role).toBe('teacher');
});
it('caps the renewed access and cookie at the remaining original deadline', async (): Promise<void> => {
  const token = refreshToken(75); const response = await refresh(request(token)); const body = await response.json();
  expect(body.data.expiresInSec).toBeLessThanOrEqual(75);
  expect(verifyToken(body.data.accessToken).exp).toBe(verifyRefreshToken(token).exp);
});
it('issues an actual two-hour refresh deadline without remember, and the configured deadline with remember', (): void => {
  const version = passwordVersion(user.passwordHash);
  const short = verifyRefreshToken(issueSession(user, version).refreshToken);
  const remembered = verifyRefreshToken(issueSession(user, version, true).refreshToken);
  expect(short.exp - short.iat!).toBe(7_200);
  expect(remembered.exp - remembered.iat!).toBe(2_592_000);
});
it.each([undefined, 'forged', 'access', 'expired', 'legacy'])('rejects invalid refresh %s and clears cookies without querying users', async (kind): Promise<void> => {
  const token = kind === 'access' ? signAccessToken({ sub: user.id, email: user.email, role: user.role }) : kind === 'expired' ? refreshToken(-1) : kind === 'legacy' ? jwt.sign({ sub: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '30d' }) : kind;
  const response = await refresh(request(token));
  expect(response.status).toBe(401); expect(response.headers.get('set-cookie')).toContain('Max-Age=0'); expect(mocks.findUnique).not.toHaveBeenCalled();
});
it.each<Record<string, string>>([{ origin: 'https://evil.example' }, { origin: '' }, { 'x-session-refresh': '' }, { 'sec-fetch-site': 'cross-site' }])('rejects cross-origin/missing JS protection', async (headers): Promise<void> => {
  const response = await refresh(request(refreshToken(), headers));
  expect(response.status).toBe(403); expect(mocks.findUnique).not.toHaveBeenCalled(); expect(response.headers.get('set-cookie')).toBeNull();
});
it.each([null, { ...user, passwordHash: 'reset-password-hash' }])('rejects deleted accounts or changed password version', async (current): Promise<void> => {
  mocks.findUnique.mockResolvedValue(current); const response = await refresh(request(refreshToken())); expect(response.status).toBe(401);
});
it('preserves cookies on database failure and hides internal details', async (): Promise<void> => {
  mocks.findUnique.mockRejectedValue(new Error('private database information'));
  const response = await refresh(request(refreshToken())); expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull(); expect(await response.text()).not.toContain('private database');
});
it('rate limits without clearing valid cookies', async (): Promise<void> => {
  mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfter: 31 });
  const response = await refresh(request(refreshToken())); expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('31'); expect(response.headers.get('set-cookie')).toBeNull();
});
it('rejects refresh bearer and algorithm substitution but accepts a short legacy access', (): void => {
  expect(parseBearer(`Bearer ${refreshToken()}`)).toBeNull();
  const payload = { sub: user.id, email: user.email, role: user.role };
  expect(parseBearer(`Bearer ${jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' })}`)?.sub).toBe(user.id);
  expect(parseBearer(`Bearer ${jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '30d' })}`)).toBeNull();
  expect(parseBearer(`Bearer ${jwt.sign(payload, process.env.JWT_SECRET!, { algorithm: 'HS512', expiresIn: '15m' })}`)).toBeNull();
});
it('logs out with expired or missing access, still rejecting cross-site logout', async (): Promise<void> => {
  const response = await logout(request()); expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('refresh_token=;'); expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await logout(request(undefined, { origin: 'https://evil.example' }))).status).toBe(403);
});
