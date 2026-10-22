import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';
import { deleteFaceTemplate } from '../../src/lib/face/template-store';

loadEnvConfig(process.cwd(), true);
const db = new PrismaClient();
type Result<T> = { data: T };

async function main(): Promise<void> {
  assert.equal(process.env.FACE_LOGIN_MODE, 'scan');
  const outputDirectory = process.argv[2];
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  const reportPath = outputDirectory ? path.join(outputDirectory, 'report.json') : 'docs/acceptance/face-scan-20261009.json';
  const id = 'face-scan-' + randomUUID();
  const account = id + '@example.com';
  const password = randomUUID() + '!Aa9';
  const portrait = 'data:image/jpeg;base64,' + (await readFile('.taskbook-working/face-infer/samples/portrait.capture.jpg')).toString('base64');
  const other = 'data:image/jpeg;base64,' + (await readFile('.taskbook-working/face-infer/samples/business-person.capture.jpg')).toString('base64');
  let token = '';
  const call = async (route: string, body?: unknown, auth = false): Promise<Response> => fetch('http://localhost:3000' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(20_000),
  });
  try {
    await db.user.create({ data: { id, email: account, nickname: '隔离扫描验收', role: 'student', passwordHash: await hashPassword(password) } });
    const passwordLogin = await call('/api/auth/login', { account, password });
    assert.equal(passwordLogin.status, 200);
    token = (await passwordLogin.json() as Result<{ accessToken: string }>).data.accessToken;
    assert.equal(await db.attendanceRecord.count({ where: { userId: id } }), 0);
    const enrollment = await call('/api/face/enroll', { consent: true, consentVersion: 'face-login-attendance-v2', captures: [portrait] }, true);
    assert.equal(enrollment.status, 201);
    const getChallenge = async (): Promise<string> => {
      const response = await call('/api/auth/face/challenge', { account });
      assert.equal(response.status, 200);
      const body = await response.json() as Result<{ challengeId: string; verificationMode: string }>;
      assert.equal(body.data.verificationMode, 'scan');
      return body.data.challengeId;
    };
    const firstChallenge = await getChallenge();
    const captures = [portrait, portrait, portrait];
    const scan = await call('/api/auth/face/login', { account, challengeId: firstChallenge, captures });
    assert.equal(scan.status, 200);
    assert.ok(scan.headers.get('set-cookie')?.includes('HttpOnly'));
    const success = await scan.json() as Result<{ accessToken: string; checkIn: { method: string; signedAt: string } }>;
    assert.equal(success.data.checkIn.method, 'face');
    token = success.data.accessToken;
    const repeat = await call('/api/auth/face/login', { account, challengeId: await getChallenge(), captures });
    assert.equal(repeat.status, 200);
    const repeated = await repeat.json() as Result<{ checkIn: { signedAt: string } }>;
    assert.equal(repeated.data.checkIn.signedAt, success.data.checkIn.signedAt);
    assert.equal(await db.attendanceRecord.count({ where: { userId: id } }), 1);
    const mismatch = await call('/api/auth/face/login', { account, challengeId: await getChallenge(), captures: [other, other, other] });
    assert.equal(mismatch.status, 401);
    assert.equal(mismatch.headers.get('set-cookie'), null);
    const replay = await call('/api/auth/face/login', { account, challengeId: firstChallenge, captures });
    assert.equal(replay.status, 401);
    assert.equal(replay.headers.get('set-cookie'), null);
    const evidence = { time: new Date().toISOString(), realModelAndHttpAndPostgresql: true, publicSampleOnly: true,
      userCameraTested: false, mode: 'scan', livenessRequired: false, staticPhotoCanAuthenticate: true,
      realEnrollmentPassed: true, genuineIdentityMatchLoginPassed: true, httpOnlySessionIssued: true,
      automaticFaceDailyCheckInPassed: true, repeatKeepsOneRecordAndFirstTime: true,
      differentPersonRejected: true, challengeReplayRejected: true, capturesPerScan: 3 };
    await writeFile(reportPath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally {
    await deleteFaceTemplate(id);
    await db.user.deleteMany({ where: { id } });
    if (outputDirectory) await writeFile(path.join(outputDirectory, 'cleanup.json'), JSON.stringify({ temporaryOwnerCleaned: await db.user.count({ where: { id } }) === 0, cleanupCompleted: true }, null, 2) + '\n');
  }
}

void main().catch((): void => { console.error('扫描登录验收失败，未输出凭据或生物数据'); process.exitCode = 1; })
  .finally(async (): Promise<void> => { await db.$disconnect(); });
