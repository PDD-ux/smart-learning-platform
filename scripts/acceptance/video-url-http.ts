import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { signAccessToken } from '../../src/lib/auth/jwt';
import type { UrlDraftView } from '../../src/lib/url-imports/contracts';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const db = new PrismaClient(), prefix = 'video-url-http-' + randomUUID(), users = [prefix + '-owner', prefix + '-other'], id = randomUUID();
const checks: { name: string; status: number }[] = [];
async function call(name: string, route: string, method: string, body: unknown, user: string | null, expected: number): Promise<UrlDraftView | undefined> {
  const response = await fetch('http://127.0.0.1:3000' + route, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: 'Bearer ' + signAccessToken({ sub: user, email: null, role: 'student' }) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  checks.push({ name, status: response.status }); assert.equal(response.status, expected, name); assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/u);
  return (await response.json() as { data?: UrlDraftView }).data;
}
async function main(): Promise<void> {
  await mkdir('.taskbook-working/video-url-20261021', { recursive: true });
  try {
    for (const user of users) await db.user.create({ data: { id: user, role: 'student', nickname: '视频链接HTTP隔离验收', passwordHash: 'unusable-acceptance-login-' + randomUUID() } });
    const body = { requestId: id, url: 'http://127.0.0.1/video.mp4', confirmed: true };
    await call('anonymous-rejected', '/api/video-imports', 'POST', body, null, 401);
    await call('consent-required', '/api/video-imports', 'POST', { ...body, confirmed: false }, users[0], 400);
    await call('unknown-owner-field-rejected', '/api/video-imports', 'POST', { ...body, ownerId: users[1] }, users[0], 400);
    assert.equal((await call('private-target-rejected', '/api/video-imports', 'POST', body, users[0], 200))?.state, 'FAILED');
    assert.equal((await call('same-request-replay', '/api/video-imports', 'POST', body, users[0], 200))?.state, 'FAILED');
    await call('changed-url-conflict', '/api/video-imports', 'POST', { ...body, url: 'https://example.org/other.mp4' }, users[0], 409);
    await call('own-status-readable', '/api/url-imports/' + id, 'GET', undefined, users[0], 200);
    await call('foreign-status-rejected', '/api/url-imports/' + id, 'GET', undefined, users[1], 404);
    await call('foreign-cancel-rejected', '/api/url-imports/' + id, 'DELETE', undefined, users[1], 404);
    assert.equal((await call('own-cancel', '/api/url-imports/' + id, 'DELETE', undefined, users[0], 200))?.state, 'CANCELLED');
    assert.equal(await db.learningContent.count({ where: { ownerId: { in: users } } }), 0);
  } finally {
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    const cleanup = { users: await db.user.count({ where: { id: { in: users } } }), contents: await db.learningContent.count({ where: { ownerId: { in: users } } }), drafts: await db.urlImportDraft.count({ where: { ownerId: { in: users } } }) };
    await writeFile('.taskbook-working/video-url-20261021/http.json', JSON.stringify({ time: new Date().toISOString(), checks, cleanup, realModelCalled: false }, null, 2));
    assert.deepEqual(cleanup, { users: 0, contents: 0, drafts: 0 });
  }
  console.log(JSON.stringify({ checks: checks.length, ok: true, realModelCalled: false }));
}
void main().catch((): void => { console.error('视频链接HTTP验收未通过；详见忽略目录报告。'); process.exitCode = 1; }).finally(async (): Promise<void> => { await db.$disconnect(); });
