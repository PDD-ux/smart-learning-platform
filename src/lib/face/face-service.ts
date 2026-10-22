import { AttendanceStatus } from '@prisma/client';

import { ErrorCode } from '@/lib/api/errors';
import { getClientIp } from '@/lib/api/rate-limit';
import { recordAudit } from '@/lib/audit/audit-service';
import { ApiError } from '@/lib/auth/ownership';
import { prisma } from '@/lib/prisma';
import { disposeFaceCaptures, type FaceCapture } from './capture';
import {
  clearFaceVerificationFailures,
  isFaceVerificationCoolingDown,
  recordFaceVerificationFailure,
} from './cooldown';
import { decryptFaceTemplateVector } from './crypto';
import {
  FaceChallengeError,
  verifyLivenessChallenge,
  type LivenessChallenge,
} from './liveness-challenge';
import { deleteFaceTemplate, replaceFaceTemplate } from './template-store';
import { writeDailyCheckIn } from './daily-check-in';
import {
  FaceProviderUnavailableError,
  getFaceVerificationProvider,
  type FaceVerificationAnalysis,
} from './verification-provider';

export type FaceTemplateStatus = {
  enrolled: boolean;
  enrolledAt: string | null;
  modelVersion: string | null;
  consentVersion: string | null;
  enrollmentPhotoExpiresAt: string | null;
};

export type FaceEnrollmentInput = {
  userId: string;
  consentVersion: string;
  captures: FaceCapture[];
  ip: string;
};

export type FaceAttendanceVerificationInput = {
  userId: string;
  challengeId: string;
  captures: FaceCapture[];
  ip: string;
};

export type FaceAttendanceVerificationResult = {
  status: 'signed_in' | 'manual_confirmation_required';
  signedAt: string | null;
  reason?: 'FACE_NOT_ENROLLED' | 'VERIFICATION_FAILED' | 'COOLDOWN';
};

/** 摄像头不可用或用户拒绝授权时的诚实降级：记录待管理员确认，不触碰任何生物数据。 */
export async function requestManualAttendance(userId: string, request: Request): Promise<FaceAttendanceVerificationResult> {
  const signedAt = await writeAttendanceRecord(userId, AttendanceStatus.MANUAL_CONFIRMATION, 'manual-confirmation-request-v1');
  await auditFaceAction(userId, 'attendance.manual.request', 'success', getClientIp(request));
  return { status: 'manual_confirmation_required', signedAt: signedAt.toISOString() };
}

function statusFromTemplate(template: {
  enrolledAt: Date;
  modelVersion: string;
  consentVersion: string;
  photoExpiresAt: Date | null;
} | null): FaceTemplateStatus {
  if (!template) {
    return {
      enrolled: false,
      enrolledAt: null,
      modelVersion: null,
      consentVersion: null,
      enrollmentPhotoExpiresAt: null,
    };
  }
  return {
    enrolled: true,
    enrolledAt: template.enrolledAt.toISOString(),
    modelVersion: template.modelVersion,
    consentVersion: template.consentVersion,
    enrollmentPhotoExpiresAt: template.photoExpiresAt?.toISOString() ?? null,
  };
}

function faceCaptureInvalid(): ApiError {
  return new ApiError(ErrorCode.FACE_CAPTURE_INVALID, '请确保画面中仅有一张清晰的人脸');
}

async function writeAttendanceRecord(
  userId: string,
  status: AttendanceStatus,
  verificationVersion: string,
): Promise<Date> {
  const record = await prisma.attendanceRecord.create({
    data: { userId, status, verificationVersion },
    select: { signedAt: true },
  });
  return record.signedAt;
}

async function auditFaceAction(
  userId: string,
  action: string,
  result: 'success' | 'failure',
  ip: string,
): Promise<void> {
  await recordAudit({ actorId: userId, objectId: userId, action, result, ip, detail: null });
}

export async function getTemplateStatus(userId: string): Promise<FaceTemplateStatus> {
  const template = await prisma.faceTemplate.findUnique({
    where: { userId },
    select: { enrolledAt: true, modelVersion: true, consentVersion: true, photoExpiresAt: true },
  });
  return statusFromTemplate(template);
}

export async function enrollFaceTemplate(input: FaceEnrollmentInput): Promise<FaceTemplateStatus> {
  let embedding: Buffer | null = null;
  try {
    const analysis = await getFaceVerificationProvider().enroll(input.captures);
    embedding = analysis.embedding;
    if (analysis.faceCount !== 1) throw faceCaptureInvalid();
    await replaceFaceTemplate({
      userId: input.userId,
      vector: embedding,
      enrollmentPhoto: input.captures[0].bytes,
      modelVersion: analysis.modelVersion,
      consentVersion: input.consentVersion,
    });
    await auditFaceAction(input.userId, 'face.template.enroll', 'success', input.ip);
    return getTemplateStatus(input.userId);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      await auditFaceAction(input.userId, 'face.template.enroll', 'failure', input.ip).catch(() => undefined);
    }
    if (error instanceof FaceProviderUnavailableError) {
      throw new ApiError(ErrorCode.FACE_SERVICE_UNAVAILABLE, '人脸验证服务暂不可用，请使用普通签到');
    }
    throw error;
  } finally {
    embedding?.fill(0);
    disposeFaceCaptures(input.captures);
  }
}

export async function removeFaceTemplate(userId: string, request: Request): Promise<boolean> {
  const deleted = await deleteFaceTemplate(userId);
  if (deleted) await auditFaceAction(userId, 'face.template.delete', 'success', getClientIp(request));
  return deleted;
}

function matchesTemplate(
  analysis: FaceVerificationAnalysis,
  templateModelVersion: string,
): boolean {
  return analysis.faceCount === 1
    && analysis.livenessPassed
    && analysis.matched
    && analysis.modelVersion === templateModelVersion;
}

export async function verifyFaceAttendance(
  input: FaceAttendanceVerificationInput,
): Promise<FaceAttendanceVerificationResult> {
  if (await isFaceVerificationCoolingDown(input.userId)) {
    return { status: 'manual_confirmation_required', signedAt: null, reason: 'COOLDOWN' };
  }
  const template = await prisma.faceTemplate.findUnique({
    where: { userId: input.userId },
    select: {
      encryptedVector: true,
      encryptionIv: true,
      authTag: true,
      keyId: true,
      modelVersion: true,
    },
  });
  if (!template) {
    throw new ApiError(ErrorCode.FACE_NOT_ENROLLED, '请先完成独立授权和人脸录入');
  }
  let challenge: LivenessChallenge;
  try {
    challenge = verifyLivenessChallenge(input.userId, input.challengeId);
  } catch (error) {
    if (error instanceof FaceChallengeError) {
      throw new ApiError(ErrorCode.FACE_CAPTURE_INVALID, '活体挑战无效或已过期');
    }
    throw error;
  }

  let embedding: Buffer | null = null;
  try {
    embedding = decryptFaceTemplateVector({
      ciphertext: template.encryptedVector,
      iv: template.encryptionIv,
      authTag: template.authTag,
      keyId: template.keyId,
    });
    const analysis = await getFaceVerificationProvider().verify({
      captures: input.captures,
      templateEmbedding: embedding,
      challengeId: input.challengeId,
      challengeAction: challenge.action,
    });
    if (!matchesTemplate(analysis, template.modelVersion)) {
      await recordFaceVerificationFailure(input.userId);
      await writeAttendanceRecord(input.userId, AttendanceStatus.MANUAL_CONFIRMATION, template.modelVersion);
      await auditFaceAction(input.userId, 'attendance.face.verify', 'failure', input.ip).catch(() => undefined);
      return { status: 'manual_confirmation_required', signedAt: null, reason: 'VERIFICATION_FAILED' };
    }
    await clearFaceVerificationFailures(input.userId);
    const daily = await writeDailyCheckIn(input.userId, 'face', template.modelVersion);
    await auditFaceAction(input.userId, 'attendance.face.verify', 'success', input.ip);
    return { status: 'signed_in', signedAt: daily.signedAt };
  } catch (error) {
    if (error instanceof FaceProviderUnavailableError) {
      await writeAttendanceRecord(input.userId, AttendanceStatus.MANUAL_CONFIRMATION, template.modelVersion);
      await auditFaceAction(input.userId, 'attendance.face.verify', 'failure', input.ip).catch(() => undefined);
      return { status: 'manual_confirmation_required', signedAt: null, reason: 'VERIFICATION_FAILED' };
    }
    throw error;
  } finally {
    embedding?.fill(0);
    disposeFaceCaptures(input.captures);
  }
}
