/** Verify server-issued sessions via real HTTP; no dependence on local signing keys. */
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
type Check = { name: string; passed: boolean; status: number };
const checks: Check[] = [];
function check(name: string, passed: boolean, status: number): void {
  checks.push({ name, passed, status }); if (!passed) throw new Error(name);
}
function claims(token: string): { exp: number; sub: string } {
  // Metadata only; authorization is tested by sending the issued token to the server.
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number; sub: string };
}
async function main(): Promise<void> {
  const output = path.resolve(process.argv[2]); await mkdir(output, { recursive: false });
  const account = `session-origin-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}!Aa9`;
  const hash = await hashPassword(password);
  const user = await db.user.create({ data: { email: account, nickname: '同源验收隔离账号', passwordHash: hash } });
  let completed = false;
  try {
    const login = await fetch('http://127.0.0.1:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.205' }, body: JSON.stringify({ account, password, remember: false }) });
    check('real_login', login.status === 200, login.status);
    const cookie = login.headers.getSetCookie().find((item): boolean => item.startsWith('refresh_token='))?.split(';')[0];
    if (!cookie) throw new Error('No refresh cookie');
    const original = claims(cookie.slice('refresh_token='.length));
    const refresh = async (base: string, extra: Record<string, string> = {}): Promise<Response> => fetch(base + '/api/auth/refresh', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'X-Session-Refresh': '1', 'X-Forwarded-For': '127.0.0.205', ...extra } });
    for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      const response = await refresh(base);
      check(`refresh_${base}`, response.status === 200, response.status);
      const body = await response.json() as { data: { accessToken: string; expiresInSec: number } };
      const access = claims(body.data.accessToken);
      check(`fixed_deadline_${base}`, access.sub === user.id && access.exp <= original.exp && body.data.expiresInSec <= 900, response.status);
      check(`no_rotation_${base}`, response.headers.get('cache-control') === 'no-store' && !response.headers.getSetCookie().some((item): boolean => item.startsWith('refresh_token=')), response.status);
      const profile = await fetch(base + '/api/gamification/profile', { headers: { Authorization: `Bearer ${body.data.accessToken}` } });
      check(`renewed_profile_${base}`, profile.status === 200, profile.status);
      const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: base, 'X-Session-Refresh': '1' } });
      check(`logout_${base}`, logout.status === 200 && /Max-Age=0/i.test(logout.headers.get('set-cookie') ?? ''), logout.status);
    }
    const forbiddenHeaders: Record<string, string>[] = [{ Origin: 'https://evil.example.test' }, { Origin: 'http://127.0.0.1:3001' }, { 'X-Session-Refresh': '' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const extra of forbiddenHeaders) {
      const response = await refresh('http://127.0.0.1:3000', extra);
      check(`rejected_${Object.keys(extra)[0]}_${Object.values(extra)[0]}`, response.status === 403 && !response.headers.has('set-cookie'), response.status);
    }
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(`Changed-${randomUUID()}`) } });
    const changed = await refresh('http://127.0.0.1:3000');
    check('password_change_invalidates_old_refresh', changed.status === 401, changed.status);
    completed = true;
  } finally {
    await db.user.delete({ where: { id: user.id } });
    const fixtureCleaned = await db.user.count({ where: { id: user.id } }) === 0;
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), completed, checks, fixtureCleaned, originalCredentialsChanged: false, originalLearningDataChanged: false }, null, 2));
    console.log(JSON.stringify({ completed, passed: checks.filter((item): boolean => item.passed).length, total: checks.length, fixtureCleaned }));
    await db.$disconnect();
  }
}
main().catch((): void => { console.error('Session origin acceptance failed; inspect sanitized report'); process.exitCode = 1; });
