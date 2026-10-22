import { createHash } from 'node:crypto';
import { ErrorCode } from '@/lib/api/errors';
import { parseAccount, type ParsedAccount } from '@/lib/auth/account';
import { ApiError } from '@/lib/auth/ownership';
import { toPublicUser, passwordVersion, type PublicUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { type FaceCapture } from './capture';
import { decryptFaceTemplateVector } from './crypto';
import { isFaceVerificationCoolingDown, recordFaceVerificationFailure, clearFaceVerificationFailures } from './cooldown';
import { writeDailyCheckIn, type DailyCheckIn } from './daily-check-in';
import { issueLivenessChallenge, verifyLivenessChallenge, FaceChallengeError, type LivenessChallenge } from './liveness-challenge';
import { getFaceVerificationProvider } from './verification-provider';
import { faceLoginMode } from './login-policy';

export const LOGIN_CONSENT_VERSION = 'face-login-attendance-v2';

export function faceLoginFailure(): ApiError {
  return new ApiError(ErrorCode.INVALID_CREDENTIALS, '人脸登录未通过，请检查账号和录入状态，或使用密码登录');
}

function accountSubject(raw: string): { account: ParsedAccount; subject: string } {
  const account = parseAccount(raw);
  if (!account) throw faceLoginFailure();
  return { account, subject: `face-login:${account.kind}:${account.value}:${faceLoginMode()}` };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 不查询账号存在性；仅存挑战摘要，数据库消费保证跨进程不能重放。 */
export async function createFaceLoginChallenge(raw: string): Promise<LivenessChallenge> {
  const { subject } = accountSubject(raw);
  const challenge = issueLivenessChallenge(subject);
  await prisma.faceLoginChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.faceLoginChallenge.create({ data: { tokenHash: tokenHash(challenge.id), expiresAt: challenge.expiresAt } });
  return challenge;
}

export async function faceLogin(raw: string, challengeId: string, captures: FaceCapture[]): Promise<{ user: PublicUser; checkIn: DailyCheckIn; credentialVersion: string }> {
  const { account, subject } = accountSubject(raw);
  let challenge: LivenessChallenge;
  try { challenge = verifyLivenessChallenge(subject, challengeId); }
  catch (error) { if (error instanceof FaceChallengeError) throw faceLoginFailure(); throw error; }
  const consumed = await prisma.faceLoginChallenge.deleteMany({ where: { tokenHash: tokenHash(challengeId), expiresAt: { gt: new Date() } } });
  if (consumed.count !== 1) throw faceLoginFailure();
  const user = await prisma.user.findUnique({ where: account.kind === 'email' ? { email: account.value } : { phone: account.value } });
  if (!user || (user.role !== 'student' && user.role !== 'teacher')) throw faceLoginFailure();
  if (await isFaceVerificationCoolingDown(user.id)) throw faceLoginFailure();
  const template = await prisma.faceTemplate.findUnique({ where: { userId: user.id } });
  if (!template || template.consentVersion !== LOGIN_CONSENT_VERSION) throw faceLoginFailure();
  let vector: Buffer | null = null;
  try {
    vector = decryptFaceTemplateVector({ ciphertext: template.encryptedVector, iv: template.encryptionIv, authTag: template.authTag, keyId: template.keyId });
    const mode = faceLoginMode();
    const analysis = await getFaceVerificationProvider().verify({ captures, templateEmbedding: vector, challengeId, challengeAction: challenge.action, verificationMode: mode });
    if ((analysis.verificationMode ?? 'action') !== mode || analysis.faceCount !== 1 || !analysis.matched || (mode === 'action' && !analysis.livenessPassed) || analysis.modelVersion !== template.modelVersion) {
      await recordFaceVerificationFailure(user.id);
      throw faceLoginFailure();
    }
    // 行锁与当前版本复核，避免远端验证期间的删除/重录/角色变更继续授权。
    const verified = await prisma.$transaction(async (tx): Promise<{ user: PublicUser; checkIn: DailyCheckIn; credentialVersion: string }> => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "FaceTemplate" WHERE "userId" = ${user.id} FOR UPDATE`;
      const currentUser = await tx.user.findUnique({ where: { id: user.id } });
      const currentTemplate = await tx.faceTemplate.findUnique({ where: { userId: user.id }, select: { id: true, updatedAt: true, consentVersion: true } });
      if (faceLoginMode() !== mode || challenge.expiresAt.getTime() <= Date.now() || !currentUser || (currentUser.role !== 'student' && currentUser.role !== 'teacher') || !currentTemplate || currentTemplate.id !== template.id || currentTemplate.updatedAt.getTime() !== template.updatedAt.getTime() || currentTemplate.consentVersion !== LOGIN_CONSENT_VERSION) throw faceLoginFailure();
      const checkIn = await writeDailyCheckIn(user.id, 'face', template.modelVersion, tx);
      return { user: toPublicUser(currentUser), checkIn, credentialVersion: passwordVersion(currentUser.passwordHash) };
    });
    await clearFaceVerificationFailures(user.id).catch(() => undefined);
    return verified;
  } finally { vector?.fill(0); }
}
