import { AttendanceStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth/jwt';

const mocks = vi.hoisted(() => ({
  user: vi.fn(), template: vi.fn(), currentUser: vi.fn(), currentTemplate: vi.fn(),
  challengeCreate: vi.fn(), challengeDelete: vi.fn(), upsert: vi.fn(), findAttendance: vi.fn(),
  verify: vi.fn(), configured: vi.fn(), decrypt: vi.fn(), cooling: vi.fn(), failure: vi.fn(), clear: vi.fn(),
  limit: vi.fn(), raw: vi.fn(),
}));
const tx = { user: { findUnique: mocks.currentUser }, faceTemplate: { findUnique: mocks.currentTemplate }, attendanceRecord: { upsert: mocks.upsert }, $queryRaw: mocks.raw };
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: mocks.user }, faceTemplate: { findUnique: mocks.template },
  faceLoginChallenge: { create: mocks.challengeCreate, deleteMany: mocks.challengeDelete },
  attendanceRecord: { findUnique: mocks.findAttendance },
  $transaction: async (fn: (db: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx),
} }));
vi.mock('@/lib/face/verification-provider', () => ({
  assertFaceLoginConfigured: mocks.configured,
  getFaceVerificationProvider: () => ({ verify: mocks.verify }),
}));
vi.mock('@/lib/face/crypto', () => ({ decryptFaceTemplateVector: mocks.decrypt }));
vi.mock('@/lib/face/cooldown', () => ({ isFaceVerificationCoolingDown: mocks.cooling, recordFaceVerificationFailure: mocks.failure, clearFaceVerificationFailures: mocks.clear }));
vi.mock('@/lib/api/rate-limit', () => ({ getClientIp: () => 'direct', rateLimit: mocks.limit }));

import { POST as CHALLENGE } from '@/app/api/auth/face/challenge/route';
import { POST as LOGIN } from '@/app/api/auth/face/login/route';
import { GET as TODAY, POST as CHECK_IN } from '@/app/api/attendance/today/route';
import { createFaceLoginChallenge, LOGIN_CONSENT_VERSION } from '@/lib/face/login';

const student = { id: 'student-1', role: 'student', email: 'student@example.com', phone: null, nickname: '测试学习者', passwordHash: 'not-returned' };
const teacher = { id: 'teacher-1', role: 'teacher', email: 'teacher@example.com', phone: null, nickname: '测试教师', passwordHash: 'not-returned' };
const template = { id: 'template-1', updatedAt: new Date('2026-10-09T00:00:00Z'), consentVersion: LOGIN_CONSENT_VERSION, encryptedVector: Buffer.from('cipher'), encryptionIv: Buffer.alloc(12), authTag: Buffer.alloc(16), keyId: 'test-key', modelVersion: 'licensed-v1' };
const png = 'data:image/png;base64,iVBORw0KGgo=';
const studentToken = signAccessToken({ sub: student.id, email: student.email, role: 'student' });
const teacherToken = signAccessToken({ sub: teacher.id, email: teacher.email, role: 'teacher' });
const challengeTokens = new Set<string>();

function request(path: string, body?: unknown, token?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function login(overrides: Record<string, unknown> = {}, account: string = student.email): Promise<Response> {
  const challenge = await createFaceLoginChallenge(account);
  return LOGIN(request('/api/auth/face/login', { account, challengeId: challenge.id, captures: [png, png], remember: false, ...overrides }));
}

describe('face login and daily check-in authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks(); challengeTokens.clear();
    vi.stubEnv('FACE_CHALLENGE_SECRET', 'test-only-secret-at-least-thirty-two-characters');
    vi.stubEnv('JWT_SECRET', 'test-secret-only-for-unit-tests');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('FACE_LOGIN_MODE', 'action');
    mocks.clear.mockResolvedValue(undefined);
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.user.mockResolvedValue(student); mocks.currentUser.mockResolvedValue(student);
    mocks.template.mockResolvedValue(template); mocks.currentTemplate.mockResolvedValue(template);
    mocks.decrypt.mockImplementation(() => Buffer.from('test-only-vector'));
    mocks.cooling.mockResolvedValue(false);
    mocks.verify.mockResolvedValue({ faceCount: 1, matched: true, livenessPassed: true, modelVersion: 'licensed-v1' });
    mocks.challengeCreate.mockImplementation(async ({ data }: { data: { tokenHash: string } }): Promise<void> => { challengeTokens.add(data.tokenHash); });
    mocks.challengeDelete.mockImplementation(async ({ where }: { where: { tokenHash?: string } }): Promise<{ count: number }> => ({ count: where.tokenHash && challengeTokens.delete(where.tokenHash) ? 1 : 0 }));
    mocks.upsert.mockImplementation(async ({ create }: { create: { status: AttendanceStatus; signedAt: Date } }) => create);
    mocks.findAttendance.mockResolvedValue(null);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('issues challenges without probing whether the account exists', async () => {
    const response = await CHALLENGE(request('/api/auth/face/challenge', { account: 'unknown@example.com' }));
    expect(response.status).toBe(200);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.challengeCreate.mock.calls[0][0].data).toEqual({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: expect.any(Date) });
  });

  it('issues a learner session only after genuine-provider test double verifies and daily record commits', async () => {
    const response = await login(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ user: { id: student.id, role: 'student' }, redirect: '/dashboard', checkIn: { checkedIn: true, method: 'face' } });
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.raw).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|embedding|encryptedVector|score|refreshToken/);
    expect(mocks.decrypt.mock.results[0].value.every((byte: number) => byte === 0)).toBe(true);
  });

  it('allows an enrolled teacher and sends the session to the teacher workspace', async () => {
    mocks.user.mockResolvedValue(teacher); mocks.currentUser.mockResolvedValue(teacher);
    const response = await login({}, teacher.email); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ user: { id: teacher.id, role: 'teacher' }, redirect: '/teacher', checkIn: { checkedIn: true, method: 'face' } });
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it.each([
    ['unknown account', null, template], ['administrator', { ...student, role: 'admin' }, template],
    ['not enrolled', student, null], ['old attendance-only consent', student, { ...template, consentVersion: 'face-attendance-v1' }],
  ])('rejects %s with the same response and no session or check-in', async (_name, user, face) => {
    mocks.user.mockResolvedValue(user); mocks.template.mockResolvedValue(face);
    const response = await login(); const body = await response.json();
    expect(response.status).toBe(401); expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers.get('set-cookie')).toBeNull(); expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    { faceCount: 2 }, { matched: false }, { livenessPassed: false }, { modelVersion: 'other-model' },
  ])('fails closed for invalid model verification %j', async (change) => {
    mocks.verify.mockResolvedValue({ faceCount: 1, matched: true, livenessPassed: true, modelVersion: 'licensed-v1', ...change });
    const response = await login();
    expect(response.status).toBe(401); expect(mocks.upsert).not.toHaveBeenCalled(); expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.failure).toHaveBeenCalledWith(student.id);
  });

  it('consumes a challenge once and refuses replay', async () => {
    const challenge = await createFaceLoginChallenge(student.email);
    const body = { account: student.email, challengeId: challenge.id, captures: [png, png] };
    expect((await LOGIN(request('/api/auth/face/login', body))).status).toBe(200);
    expect((await LOGIN(request('/api/auth/face/login', body))).status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });

  it('explicit scan policy permits genuine identity match without pretending liveness passed', async () => {
    vi.stubEnv('FACE_LOGIN_MODE', 'scan');
    mocks.verify.mockResolvedValue({ faceCount: 1, matched: true, livenessPassed: false, modelVersion: 'licensed-v1', verificationMode: 'scan' });
    const response = await login();
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ verificationMode: 'scan' }));
    expect(mocks.upsert).toHaveBeenCalled();
  });

  it('scan rejects a mismatched provider policy', async () => {
    vi.stubEnv('FACE_LOGIN_MODE', 'scan');
    expect((await login()).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('client cannot downgrade configured action policy to scan', async () => {
    mocks.verify.mockResolvedValue({ faceCount: 1, matched: true, livenessPassed: false, modelVersion: 'licensed-v1', verificationMode: 'scan' });
    expect((await login({ verificationMode: 'scan' })).status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ verificationMode: 'action' }));
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('invalidates issued tickets when server policy changes', async () => {
    const challenge = await createFaceLoginChallenge(student.email);
    vi.stubEnv('FACE_LOGIN_MODE', 'scan');
    expect((await LOGIN(request('/api/auth/face/login', { account: student.email, challengeId: challenge.id, captures: [png, png] }))).status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('rejects account substitution and expiration without contacting the model', async () => {
    const challenge = await createFaceLoginChallenge(student.email);
    const body = { account: 'other@example.com', challengeId: challenge.id, captures: [png, png] };
    expect((await LOGIN(request('/api/auth/face/login', body))).status).toBe(401);
    vi.spyOn(Date, 'now').mockReturnValue(challenge.expiresAt.getTime() + 1);
    // HMAC verifier uses new Date(); make time advancement explicit via fake timers.
    vi.useFakeTimers(); vi.setSystemTime(challenge.expiresAt.getTime() + 1);
    try { expect((await LOGIN(request('/api/auth/face/login', { ...body, account: student.email }))).status).toBe(401); }
    finally { vi.useRealTimers(); vi.restoreAllMocks(); }
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['role changed', { ...student, role: 'admin' }, template], ['template deleted', student, null],
    ['template replaced', student, { ...template, updatedAt: new Date('2026-10-09T00:01:00Z') }],
  ])('rechecks %s after remote verification', async (_name, currentUser, currentTemplate) => {
    mocks.currentUser.mockResolvedValue(currentUser); mocks.currentTemplate.mockResolvedValue(currentTemplate);
    const response = await login();
    expect(response.status).toBe(401); expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('service failure creates neither a session nor a pending check-in', async () => {
    mocks.verify.mockRejectedValue(new Error('provider unavailable'));
    const response = await login();
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull(); expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('does not open a challenge when configuration is missing', async () => {
    mocks.configured.mockImplementation(() => { throw new Error('missing'); });
    expect((await CHALLENGE(request('/api/auth/face/challenge', { account: student.email }))).status).toBe(503);
    expect(mocks.challengeCreate).not.toHaveBeenCalled();
  });

  it('rejects authentication throttling and a single static frame', async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    expect((await login()).status).toBe(429);
    expect((await login({ captures: [png] })).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('manual check-in is authenticated, rechecks current role and is not face verification', async () => {
    expect((await CHECK_IN(request('/api/attendance/today', {}))).status).toBe(401);
    const response = await CHECK_IN(request('/api/attendance/today', {}, studentToken));
    expect(response.status).toBe(200); expect((await response.json()).data).toMatchObject({ method: 'manual', checkedIn: true });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {}, create: expect.objectContaining({ status: AttendanceStatus.SELF_CHECK_IN, verificationVersion: 'self-check-in-v1' }) }));
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ ...student, role: 'admin' });
    expect((await CHECK_IN(request('/api/attendance/today', {}, studentToken))).status).toBe(403);
  });

  it('allows a teacher to read and record only their own daily check-in', async () => {
    mocks.user.mockResolvedValue(teacher); mocks.currentUser.mockResolvedValue(teacher);
    const response = await CHECK_IN(request('/api/attendance/today', {}, teacherToken));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ method: 'manual', checkedIn: true });
    mocks.user.mockResolvedValue({ ...teacher, role: 'admin' });
    expect((await CHECK_IN(request('/api/attendance/today', {}, teacherToken))).status).toBe(403);
  });

  it('reads an existing ordinary check-in and face login preserves its first method/time', async () => {
    const old = { status: AttendanceStatus.SELF_CHECK_IN, signedAt: new Date('2026-10-09T01:00:00Z') };
    mocks.findAttendance.mockResolvedValue(old); mocks.upsert.mockResolvedValue(old);
    const response = await TODAY(request('/api/attendance/today', undefined, studentToken));
    expect((await response.json()).data).toMatchObject({ method: 'manual', signedAt: old.signedAt.toISOString() });
    const face = await login(); expect((await face.json()).data.checkIn.method).toBe('manual');
  });
});
