import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { PrismaClient, AttendanceStatus } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = process.env.UI_ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';
const fixturePath = resolve('.taskbook-working/face-login-ui-fixture.json');

async function main(): Promise<void> {
  if (process.argv.includes('--cleanup-ui')) {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { id: string };
    assert.match(fixture.id, /^daily-ui-[a-f0-9-]{36}$/);
    await db.user.deleteMany({ where: { id: fixture.id } }); await unlink(fixturePath);
    console.log(JSON.stringify({ uiFixture: 'cleaned' })); return;
  }
  const runId = randomUUID();
  const id = 'daily-ui-' + runId;
  const adminId = 'daily-admin-' + runId;
  const password = randomUUID() + '!Aa9';
  const email = id + '@example.com';
  const passwordHash = await hashPassword(password);
  let keep = false;
  try {
    await db.user.create({ data: { id, email, nickname: '隔离打卡验收', role: 'student', passwordHash } });
    await db.user.create({ data: { id: adminId, email: adminId + '@example.com', nickname: '隔离管理验收', role: 'admin', passwordHash } });
    const signIn = async (account: string): Promise<string> => {
      const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password, remember: false }) });
      assert.equal(response.status, 200);
      const body = await response.json() as { data: { accessToken: string } }; return body.data.accessToken;
    };
    const token = await signIn(email);
    const call = async (method: 'GET' | 'POST', bearer: string = token): Promise<Response> => fetch(base + '/api/attendance/today', { method, headers: { authorization: 'Bearer ' + bearer } });
    const before = await (await call('GET')).json() as { data: { checkedIn: boolean } };
    assert.equal(before.data.checkedIn, false);
    assert.equal(await db.attendanceRecord.count({ where: { userId: id } }), 0, '密码登录不能自动打卡');
    const concurrent = await Promise.all(Array.from({ length: 5 }, async () => {
      const response = await call('POST'); assert.equal(response.status, 200);
      return (await response.json() as { data: { date: string; method: string; signedAt: string } }).data;
    }));
    assert.equal(new Set(concurrent.map((record) => record.signedAt)).size, 1);
    assert.ok(concurrent.every((record) => record.method === 'manual'));
    const records = await db.attendanceRecord.findMany({ where: { userId: id } });
    assert.equal(records.length, 1); assert.equal(records[0].status, AttendanceStatus.SELF_CHECK_IN);
    assert.equal(records[0].checkInDay, concurrent[0].date);
    const adminToken = await signIn(adminId + '@example.com');
    assert.equal((await call('POST', adminToken)).status, 403);
    assert.equal((await fetch(base + '/api/attendance/today')).status, 401);
    const overviewResponse = await fetch(base + '/api/admin/overview', { headers: { authorization: 'Bearer ' + adminToken } });
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json() as { data: { attendance: { total: number; signedIn: number; selfCheckIn: number; manualConfirmation: number } } };
    const stats = overview.data.attendance;
    assert.equal(stats.total, stats.signedIn + stats.selfCheckIn + stats.manualConfirmation);
    const listed = await fetch(base + '/api/admin/attendance?userId=' + id + '&status=self_check_in', { headers: { authorization: 'Bearer ' + adminToken } });
    const listBody = await listed.json() as { data: { total: number; items: { status: string }[] } };
    assert.equal(listed.status, 200); assert.equal(listBody.data.total, 1); assert.equal(listBody.data.items[0].status, 'self_check_in');
    const faceResponse = await fetch(base + '/api/auth/face/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: email }) });
    const faceBody = await faceResponse.json() as { error?: { code: string } };
    const configKeys = ['FACE_VERIFICATION_PROVIDER', 'FACE_INFER_URL', 'FACE_INFER_MODEL_VERSION', 'FACE_CHALLENGE_SECRET', 'FACE_TEMPLATE_ENCRYPTION_KEY', 'FACE_TEMPLATE_ENCRYPTION_KEY_ID', 'FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY', 'FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY_ID'];
    const evidence = { time: new Date().toISOString(), base, passwordLoginDoesNotCheckIn: true, manualConcurrentRequests: 5, dailyRecordCount: 1, firstTimestampPreserved: true, ordinaryIsNotBiometricVerification: true, adminAndAnonymousRejected: true, adminFilterAndTotalsPassed: true, faceChallenge: { status: faceResponse.status, code: faceBody.error?.code ?? null, realBiometricVerification: 'NOT_RUN' }, faceConfigurationPresent: Object.fromEntries(configKeys.map((key) => [key, Boolean(process.env[key]?.trim())])) };
    await mkdir('docs/acceptance', { recursive: true });
    await writeFile('docs/acceptance/face-login-daily-20261009.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
    if (process.argv.includes('--keep-ui')) {
      await mkdir('.taskbook-working', { recursive: true });
      // 仅本地短期验收凭据，ignored；浏览器验收结束即 cleanup，不输出密码或token。
      await writeFile(fixturePath, JSON.stringify({ id, account: email, password })); keep = true;
      console.log(JSON.stringify({ uiFixture: 'ready', fixturePath }));
    }
  } finally {
    if (!keep) await db.user.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: adminId } });
  }
}
void main().catch((): void => { console.error('每日打卡验收失败；不输出凭据或响应原文'); process.exitCode = 1; }).finally(async (): Promise<void> => { await db.$disconnect(); });
