import { AttendanceStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '@/lib/auth/jwt';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  faceTemplateFindUnique: vi.fn(),
  attendanceCreate: vi.fn(),
  attendanceCount: vi.fn(),
  attendanceFindMany: vi.fn(),
  transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  recordAudit: vi.fn(async () => undefined),
  replaceTemplate: vi.fn(async () => undefined),
  deleteTemplate: vi.fn(async () => true),
  isCoolingDown: vi.fn(async () => false),
  recordFailure: vi.fn(async () => undefined),
  clearFailures: vi.fn(async () => undefined),
  decryptTemplate: vi.fn(() => Buffer.from('template-embedding')),
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 4, retryAfter: 0 })),
}));

let provider: {
  enroll: (captures: readonly { mimeType: string; bytes: Buffer }[]) => Promise<{ faceCount: number; embedding: Buffer; modelVersion: string }>;
  verify: (input: { captures: readonly { mimeType: string; bytes: Buffer }[]; templateEmbedding: Buffer; challengeId: string }) => Promise<{ faceCount: number; matched: boolean; livenessPassed: boolean; modelVersion: string }>;
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    faceTemplate: { findUnique: mocks.faceTemplateFindUnique },
    attendanceRecord: {
      create: mocks.attendanceCreate,
      count: mocks.attendanceCount,
      findMany: mocks.attendanceFindMany,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/audit/audit-service', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/face/template-store', () => ({
  replaceFaceTemplate: mocks.replaceTemplate,
  deleteFaceTemplate: mocks.deleteTemplate,
}));
vi.mock('@/lib/face/cooldown', () => ({
  isFaceVerificationCoolingDown: mocks.isCoolingDown,
  recordFaceVerificationFailure: mocks.recordFailure,
  clearFaceVerificationFailures: mocks.clearFailures,
}));
vi.mock('@/lib/face/crypto', () => ({ decryptFaceTemplateVector: mocks.decryptTemplate }));
vi.mock('@/lib/face/verification-provider', () => ({
  FaceProviderUnavailableError: class FaceProviderUnavailableError extends Error {},
  getFaceVerificationProvider: () => provider,
}));
vi.mock('@/lib/face/liveness-challenge', () => ({
  FaceChallengeError: class FaceChallengeError extends Error {},
  issueLivenessChallenge: () => ({
    id: 'signed-challenge',
    action: 'blink',
    expiresAt: new Date('2026-09-24T00:02:00.000Z'),
  }),
  verifyLivenessChallenge: () => ({ action: 'blink', expiresAt: new Date('2026-09-24T00:02:00.000Z') }),
}));
vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => 'direct',
  rateLimit: mocks.rateLimit,
  RateLimitPolicy: { face: { limit: 5, windowMs: 60_000 } },
}));

import { POST as ENROLL } from '@/app/api/face/enroll/route';
import { DELETE as DELETE_TEMPLATE, GET as GET_TEMPLATE } from '@/app/api/face/template/route';
import { POST as VERIFY } from '@/app/api/attendance/verify/route';
import { POST as ISSUE_CHALLENGE } from '@/app/api/attendance/challenge/route';
import { POST as REQUEST_MANUAL } from '@/app/api/attendance/manual/route';
import { GET as LIST_ATTENDANCE } from '@/app/api/admin/attendance/route';

const studentToken = signAccessToken({ sub: 'student-1', email: 'student@example.com', role: 'student' });
const teacherToken = signAccessToken({ sub: 'teacher-1', email: 'teacher@example.com', role: 'teacher' });
const adminToken = signAccessToken({ sub: 'admin-1', email: 'admin@example.com', role: 'admin' });
const capture = 'data:image/png;base64,iVBORw0KGgo=';

function request(path: string, token: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('face attendance API boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider = {
      enroll: async () => ({ faceCount: 1, embedding: Buffer.from('enrollment-embedding'), modelVersion: 'licensed-model-v1' }),
      verify: async () => ({ faceCount: 1, matched: true, livenessPassed: true, modelVersion: 'licensed-model-v1' }),
    };
    mocks.faceTemplateFindUnique.mockResolvedValue(null);
    mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ role: where.id === 'admin-1' ? 'admin' : where.id === 'teacher-1' ? 'teacher' : 'student' }));
    mocks.attendanceCreate.mockResolvedValue({ signedAt: new Date('2026-09-24T00:00:00.000Z') });
    mocks.attendanceCount.mockResolvedValue(0);
    mocks.attendanceFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires separate consent before enrollment', async () => {
    const response = await ENROLL(request('/api/face/enroll', studentToken, 'POST', {
      consent: false,
      consentVersion: 'face-login-attendance-v2',
      captures: [capture],
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('FACE_CONSENT_REQUIRED');
    expect(mocks.replaceTemplate).not.toHaveBeenCalled();
  });

  it('issues a user-bound liveness challenge without any biometric payload', async () => {
    const response = await ISSUE_CHALLENGE(request('/api/attendance/challenge', studentToken, 'POST'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      challengeId: 'signed-challenge',
      action: 'blink',
      expiresAt: '2026-09-24T00:02:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('embedding');
  });

  it('returns status only after encrypted enrollment and never returns vectors or object keys', async () => {
    mocks.faceTemplateFindUnique.mockResolvedValue({
      enrolledAt: new Date('2026-09-24T00:00:00.000Z'),
      modelVersion: 'licensed-model-v1',
      consentVersion: 'face-login-attendance-v2',
      photoExpiresAt: new Date('2026-10-24T00:00:00.000Z'),
    });
    const response = await ENROLL(request('/api/face/enroll', studentToken, 'POST', {
      consent: true,
      consentVersion: 'face-login-attendance-v2',
      captures: [capture],
    }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      enrolled: true,
      enrolledAt: '2026-09-24T00:00:00.000Z',
      modelVersion: 'licensed-model-v1',
      consentVersion: 'face-login-attendance-v2',
      enrollmentPhotoExpiresAt: '2026-10-24T00:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('embedding');
    expect(JSON.stringify(body)).not.toContain('enrollmentPhotoKey');
  });

  it('allows teachers to manage their own template and use their own face attendance endpoints', async () => {
    const enrollment = await ENROLL(request('/api/face/enroll', teacherToken, 'POST', {
      consent: true,
      consentVersion: 'face-login-attendance-v2',
      captures: [capture],
    }));
    expect(enrollment.status).toBe(201);
    expect(mocks.replaceTemplate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'teacher-1' }));

    expect((await GET_TEMPLATE(request('/api/face/template', teacherToken))).status).toBe(200);
    expect((await ISSUE_CHALLENGE(request('/api/attendance/challenge', teacherToken, 'POST'))).status).toBe(200);
    expect((await REQUEST_MANUAL(request('/api/attendance/manual', teacherToken, 'POST'))).status).toBe(200);
  });

  it('rejects administrators from all personal face enrollment and attendance endpoints', async () => {
    const requests = await Promise.all([
      ENROLL(request('/api/face/enroll', adminToken, 'POST', { consent: true, consentVersion: 'face-login-attendance-v2', captures: [capture] })),
      GET_TEMPLATE(request('/api/face/template', adminToken)),
      DELETE_TEMPLATE(request('/api/face/template', adminToken, 'DELETE')),
      ISSUE_CHALLENGE(request('/api/attendance/challenge', adminToken, 'POST')),
      REQUEST_MANUAL(request('/api/attendance/manual', adminToken, 'POST')),
    ]);
    expect(requests.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(mocks.replaceTemplate).not.toHaveBeenCalled();
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('returns manual confirmation without a score when verification does not match', async () => {
    mocks.faceTemplateFindUnique.mockResolvedValue({
      encryptedVector: Buffer.from('ciphertext'),
      encryptionIv: Buffer.alloc(12),
      authTag: Buffer.alloc(16),
      keyId: 'template-key-v1',
      modelVersion: 'licensed-model-v1',
    });
    provider.verify = async () => ({ faceCount: 1, matched: false, livenessPassed: true, modelVersion: 'licensed-model-v1' });
    const response = await VERIFY(request('/api/attendance/verify', studentToken, 'POST', {
      challengeId: 'turn-left-1',
      captures: [capture],
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: 'manual_confirmation_required', signedAt: null, reason: 'VERIFICATION_FAILED' });
    expect(mocks.attendanceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AttendanceStatus.MANUAL_CONFIRMATION }),
    }));
    expect(JSON.stringify(body)).not.toContain('score');
  });

  it('rejects attendance when no template exists', async () => {
    const response = await VERIFY(request('/api/attendance/verify', studentToken, 'POST', {
      challengeId: 'blink-1',
      captures: [capture],
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('FACE_NOT_ENROLLED');
  });

  it('allows a signed-in learner to request manual confirmation without a capture', async () => {
    const response = await REQUEST_MANUAL(request('/api/attendance/manual', studentToken, 'POST'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: 'manual_confirmation_required', signedAt: '2026-09-24T00:00:00.000Z' });
    expect(mocks.attendanceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AttendanceStatus.MANUAL_CONFIRMATION, verificationVersion: 'manual-confirmation-request-v1' }),
    }));
    expect(JSON.stringify(body)).not.toContain('capture');
  });

  it('allows only the owner to inspect/delete their template and only admin to list attendance', async () => {
    const templateResponse = await GET_TEMPLATE(request('/api/face/template', studentToken));
    expect(templateResponse.status).toBe(200);
    const deletion = await DELETE_TEMPLATE(request('/api/face/template', studentToken, 'DELETE'));
    expect(deletion.status).toBe(200);

    const forbidden = await LIST_ATTENDANCE(request('/api/admin/attendance', studentToken));
    expect(forbidden.status).toBe(403);
    expect(mocks.attendanceFindMany).not.toHaveBeenCalled();
  });
});
