import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

loadEnvConfig(process.cwd());

const origin = 'http://localhost:3000';
const sessionSchema = z.object({ success: z.literal(true), data: z.object({ accessToken: z.string(), user: z.object({ id: z.string(), role: z.string() }).passthrough(), expiresInSec: z.number().optional() }).passthrough() });
type Check = { name: string; passed: boolean; status?: number };

async function main(): Promise<void> {
  const [directory] = process.argv.slice(2);
  if (!directory || process.argv.length !== 3) throw new Error('用法：tsx scripts/acceptance/auth-session.ts .taskbook-working/<新目录>');
  const output = resolve(directory);
  const inside = relative(resolve('.taskbook-working'), output);
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || inside.includes(sep)) throw new Error('结果目录须为.taskbook-working下的新直接子目录');
  await mkdir(output, { recursive: false });
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken, signRefreshToken, verifyRefreshToken, verifyToken, refreshTtlSec, accessTtlSec } = await import('../../src/lib/auth/jwt');
  const { passwordVersion } = await import('../../src/lib/auth/session');
  const checks: Check[] = [];
  let fixtureId: string | null = null;
  let cleanupPassed = false;
  let completed = false;
  const save = async (name: string, value: unknown): Promise<void> => { await writeFile(resolve(output, `${name}.json`), JSON.stringify(value, null, 2), { flag: 'wx' }); };
  const check = (name: string, passed: boolean, status?: number): void => { checks.push({ name, passed, ...(status === undefined ? {} : { status }) }); if (!passed) throw new Error(`验收未通过：${name}`); };
  const call = async (path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown): Promise<Response> => fetch(`${origin}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const refresh = async (token?: string, requestOrigin = origin): Promise<Response> => call('/api/auth/refresh', 'POST', { Origin: requestOrigin, 'X-Session-Refresh': '1', ...(token ? { Cookie: `refresh_token=${token}` } : {}) });
  try {
    const password = `Acceptance-${randomUUID()}`;
    const email = `session-${randomUUID()}@example.test`;
    const hash = await bcrypt.hash(password, 12);
    const fixture = await prisma.user.create({ data: { email, nickname: '登录续期隔离验收', passwordHash: hash }, select: { id: true } });
    fixtureId = fixture.id;
    const claims = { sub: fixture.id, email, role: 'student' };
    const login = await call('/api/auth/login', 'POST', {}, { account: email, password, remember: false });
    check('real_password_login', login.status === 200, login.status);
    const initial = sessionSchema.parse(await login.json()).data;
    const refreshCookie = login.headers.getSetCookie().find((value) => value.startsWith('refresh_token='));
    const cookie = refreshCookie?.match(/^refresh_token=([^;]+)/)?.[1];
    check('refresh_cookie_http_only', Boolean(cookie && /;\s*HttpOnly(?:;|$)/i.test(refreshCookie ?? '')));
    if (!cookie) throw new Error('验收未取得HttpOnly刷新令牌');
    const original = verifyRefreshToken(cookie);
    check('unremembered_signed_deadline', original.exp - original.iat! === Math.min(7_200, refreshTtlSec()));
    const expiredAccess = signAccessToken(claims, -1);
    const expired = await call('/api/gamification/profile', 'GET', { Authorization: `Bearer ${expiredAccess}` });
    check('expired_access_rejected', expired.status === 401, expired.status);
    const renewed = await refresh(cookie);
    check('refresh_recovers_expired_access', renewed.status === 200, renewed.status);
    const next = sessionSchema.parse(await renewed.json()).data;
    check('same_user_and_no_private_response', next.user.id === fixtureId && !('credentialVersion' in next) && !('credentialVersion' in next.user) && !('passwordHash' in next.user) && !('refreshToken' in next));
    check('no_store_and_no_refresh_rotation', renewed.headers.get('cache-control') === 'no-store' && !/refresh_token=/.test(renewed.headers.get('set-cookie') ?? ''));
    const newClaims = verifyToken(next.accessToken);
    check('access_within_original_deadline', newClaims.exp! <= original.exp && next.expiresInSec! <= accessTtlSec());
    const profile = await call('/api/gamification/profile', 'GET', { Authorization: `Bearer ${next.accessToken}` });
    check('renewed_access_reads_real_profile', profile.status === 200, profile.status);
    const denied = await call('/api/admin/overview', 'GET', { Authorization: `Bearer ${next.accessToken}` });
    check('student_admin_route_forbidden', denied.status === 403, denied.status);
    const bearer = await call('/api/gamification/profile', 'GET', { Authorization: `Bearer ${cookie}` });
    check('refresh_cannot_be_access_bearer', bearer.status === 401, bearer.status);
    const wrongPurpose = await refresh(initial.accessToken);
    check('access_cannot_be_refresh_cookie', wrongPurpose.status === 401, wrongPurpose.status);
    const missing = await refresh();
    check('missing_refresh_rejected', missing.status === 401, missing.status);
    const cross = await refresh(cookie, 'https://invalid.example');
    check('cross_origin_rejected_without_clearing', cross.status === 403 && !cross.headers.has('set-cookie'), cross.status);
    const expiredRefresh = await refresh(signRefreshToken(claims, passwordVersion(hash), -1));
    check('expired_refresh_rejected', expiredRefresh.status === 401, expiredRefresh.status);
    const legacy = jwt.sign(claims, process.env.JWT_SECRET?.trim() || 'local-development-only-jwt-secret-not-for-production', { algorithm: 'HS256', expiresIn: 2_592_000 });
    const legacyResponse = await refresh(legacy);
    check('legacy_untyped_refresh_requires_login', legacyResponse.status === 401, legacyResponse.status);
    const short = await refresh(signRefreshToken(claims, passwordVersion(hash), 75));
    check('short_remaining_deadline_accepted', short.status === 200, short.status);
    const shortData = sessionSchema.parse(await short.json()).data;
    check('short_remaining_deadline_caps_access', shortData.expiresInSec! > 0 && shortData.expiresInSec! <= 75);
    await prisma.user.update({ where: { id: fixtureId }, data: { role: 'admin' } });
    const role = await refresh(cookie);
    check('current_database_role_reloaded', role.status === 200 && sessionSchema.parse(await role.json()).data.user.role === 'admin', role.status);
    await prisma.user.update({ where: { id: fixtureId }, data: { role: 'student', passwordHash: await bcrypt.hash(`Changed-${randomUUID()}`, 12) } });
    const changed = await refresh(cookie);
    check('password_change_rejects_old_refresh', changed.status === 401 && /Max-Age=0/i.test(changed.headers.get('set-cookie') ?? ''), changed.status);
    const logout = await call('/api/auth/logout', 'POST', { Origin: origin, 'X-Session-Refresh': '1', Authorization: `Bearer ${expiredAccess}` });
    check('expired_access_logout_clears_cookies', logout.status === 200 && /Max-Age=0/i.test(logout.headers.get('set-cookie') ?? ''), logout.status);
    const safe = await prisma.user.findUniqueOrThrow({ where: { id: fixtureId }, select: { xpTotal: true, _count: { select: { contents: true, notes: true, masteries: true, studyPlans: true, attendanceRecords: true } } } });
    check('fixture_no_learning_writes', safe.xpTotal === 0 && Object.values(safe._count).every((count) => count === 0));
    await prisma.user.delete({ where: { id: fixtureId } });
    cleanupPassed = await prisma.user.count({ where: { id: fixtureId } }) === 0;
    const deleted = await refresh(cookie);
    check('deleted_user_cannot_renew', deleted.status === 401, deleted.status);
    completed = true;
  } finally {
    try {
      if (fixtureId && !cleanupPassed) {
        await prisma.user.deleteMany({ where: { id: fixtureId } });
        cleanupPassed = await prisma.user.count({ where: { id: fixtureId } }) === 0;
      }
      await save('report', { verifiedAt: new Date().toISOString(), target: origin, completed, checks, cleanupPassed, modelCalled: false, existingCredentialsChanged: false, browserSessionTouched: false });
      process.stdout.write(JSON.stringify({ completed, passed: checks.filter((row) => row.passed).length, total: checks.length, cleanupPassed, modelCalled: false }) + '\n');
    } finally { await prisma.$disconnect(); }
  }
  if (!cleanupPassed) throw new Error('隔离账号清理未完成');
}

void main().catch((): void => { process.stderr.write('登录续期验收未全部通过，请查看新目录中的固定检查结果；不会输出凭据或原始异常。\n'); process.exitCode = 1; });
