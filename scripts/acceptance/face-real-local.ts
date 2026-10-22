import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';
import { decryptFaceTemplateVector } from '../../src/lib/face/crypto';
import { deleteFaceTemplate } from '../../src/lib/face/template-store';
import { getStorage } from '../../src/lib/storage';

loadEnvConfig(process.cwd(), true);
const db = new PrismaClient();
const base = 'http://localhost:3000';
type Envelope<T> = { data: T; error?: { code: string } };
let phase = 'setup';

async function main(): Promise<void> {
  assert.equal(process.env.FACE_INFER_URL, 'http://127.0.0.1:8002');
  const id = 'face-real-' + randomUUID();
  const account = id + '@example.com';
  const password = randomUUID() + '!Aa9';
  const portrait = 'data:image/jpeg;base64,' + (await readFile('.taskbook-working/face-infer/samples/portrait.capture.jpg')).toString('base64');
  const other = 'data:image/jpeg;base64,' + (await readFile('.taskbook-working/face-infer/samples/business-person.capture.jpg')).toString('base64');
  const checks: Record<string, boolean> = {};
  let token = '';
  const call = async (route: string, method: string, body?: unknown, auth = false): Promise<Response> => fetch(base + route, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  try {
    await db.user.create({ data: { id, email: account, nickname: '隔离真实人脸验收', role: 'student', passwordHash: await hashPassword(password) } });
    phase = 'password login';
    const login = await call('/api/auth/login', 'POST', { account, password });
    assert.equal(login.status, 200);
    token = (await login.json() as Envelope<{ accessToken: string }>).data.accessToken;
    checks.passwordNoCheckIn = await db.attendanceRecord.count({ where: { userId: id } }) === 0;
    const denied = await call('/api/face/enroll', 'POST', { consent: false, consentVersion: 'face-login-attendance-v2', captures: [portrait] }, true);
    assert.equal(denied.status, 400); checks.independentConsentRequired = true;
    // Public model fixture only, isolated account; this never grants consent for the human user.
    phase = 'real enrollment';
    const enrollment = await call('/api/face/enroll', 'POST', { consent: true, consentVersion: 'face-login-attendance-v2', captures: [portrait] }, true);
    assert.equal(enrollment.status, 201);
    const status = await enrollment.json() as Envelope<{ enrolled: boolean; modelVersion: string }>;
    assert.equal(status.data.enrolled, true);
    assert.equal(status.data.modelVersion, process.env.FACE_INFER_MODEL_VERSION);
    checks.realHttpEnrollment = true;
    checks.browserResponseHasNoVector = !JSON.stringify(status).includes('embedding');
    const template = await db.faceTemplate.findUniqueOrThrow({ where: { userId: id } });
    phase = 'encrypted template';
    const vector = decryptFaceTemplateVector({ ciphertext: template.encryptedVector, iv: template.encryptionIv, authTag: template.authTag, keyId: template.keyId });
    try {
      assert.equal(vector.length, 512);
      assert.equal(template.encryptedVector.equals(vector), false);
      checks.vectorEncryptedInDatabase = true;
    } finally { vector.fill(0); }
    assert.ok(template.enrollmentPhotoKey && template.photoExpiresAt);
    assert.ok(await getStorage().statObject(template.enrollmentPhotoKey));
    checks.encryptedPrivatePhotoStored = true;
    const failedLogin = async (image: string): Promise<string> => {
      const challengeResponse = await call('/api/auth/face/challenge', 'POST', { account });
      assert.equal(challengeResponse.status, 200);
      const challenge = (await challengeResponse.json() as Envelope<{ challengeId: string }>).data;
      const response = await call('/api/auth/face/login', 'POST', { account, challengeId: challenge.challengeId, captures: Array.from({ length: 11 }, (): string => image) });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('set-cookie'), null);
      const result = await response.json() as Envelope<unknown>;
      assert.equal(result.error?.code, 'INVALID_CREDENTIALS');
      return challenge.challengeId;
    };
    phase = 'static photo login';
    const consumed = await failedLogin(portrait); checks.staticPhotoCannotLogin = true;
    phase = 'different person login';
    await failedLogin(other); checks.differentPersonCannotLogin = true;
    phase = 'replay challenge';
    const replay = await call('/api/auth/face/login', 'POST', { account, challengeId: consumed, captures: Array.from({ length: 11 }, (): string => portrait) });
    assert.equal(replay.status, 401);
    assert.equal(replay.headers.get('set-cookie'), null); checks.challengeCannotReplay = true;
    assert.equal(await db.attendanceRecord.count({ where: { userId: id } }), 0); checks.failedVerificationNoCheckIn = true;
    phase = 'delete template';
    const deletion = await call('/api/face/template', 'DELETE', undefined, true);
    assert.equal(deletion.status, 200);
    assert.equal(await db.faceTemplate.count({ where: { userId: id } }), 0);
    assert.equal(await getStorage().statObject(template.enrollmentPhotoKey), null);
    checks.deleteRemovesTemplateAndPhoto = true;
    const evidence = { time: new Date().toISOString(), realModels: true, realHttpAndPostgresql: true,
      userCameraTested: false, successfulFaceLoginTested: false, publicFixtureOnly: true, checks };
    assert.ok(Object.values(checks).every(Boolean));
    await writeFile('docs/acceptance/face-real-product-20261009.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally {
    // Remove private encrypted fixture photo before cascading the isolated account.
    await deleteFaceTemplate(id);
    await db.user.deleteMany({ where: { id } });
  }
}

void main().catch((error: unknown): void => {
  console.error('真实人脸产品验收失败，阶段：' + phase);
  if (error instanceof assert.AssertionError && typeof error.actual === 'number' && typeof error.expected === 'number') console.error(JSON.stringify({ actual: error.actual, expected: error.expected }));
  process.exitCode = 1;
})
  .finally(async (): Promise<void> => { await db.$disconnect(); });
