import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const CHALLENGE_TTL_MS = 2 * 60 * 1_000;
const ACTIONS = ['blink', 'turn_left', 'turn_right'] as const;

export type LivenessAction = (typeof ACTIONS)[number];
export type LivenessChallenge = {
  id: string;
  action: LivenessAction;
  expiresAt: Date;
};

export class FaceChallengeError extends Error {
  constructor() {
    super('活体挑战无效或已过期');
    this.name = 'FaceChallengeError';
  }
}

function challengeSecret(): string {
  const secret = process.env.FACE_CHALLENGE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new FaceChallengeError();
  return secret;
}

function subjectHash(userId: string): string {
  return createHash('sha256').update(userId).digest('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', challengeSecret()).update(payload).digest('base64url');
}

function actionForNonce(nonce: string): LivenessAction {
  const index = Number.parseInt(nonce.slice(0, 2), 16) % ACTIONS.length;
  return ACTIONS[index];
}

export function issueLivenessChallenge(userId: string, now: Date = new Date()): LivenessChallenge {
  const nonce = randomUUID().replace(/-/g, '');
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const action = actionForNonce(nonce);
  const payload = Buffer.from(JSON.stringify({ h: subjectHash(userId), a: action, e: expiresAt.getTime(), n: nonce })).toString('base64url');
  return { id: `${payload}.${sign(payload)}`, action, expiresAt };
}

export function verifyLivenessChallenge(userId: string, id: string, now: Date = new Date()): LivenessChallenge {
  const [payload, signature, ...rest] = id.split('.');
  if (!payload || !signature || rest.length > 0) throw new FaceChallengeError();
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new FaceChallengeError();
  let parsed: { h?: unknown; a?: unknown; e?: unknown; n?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      h?: unknown;
      a?: unknown;
      e?: unknown;
      n?: unknown;
    };
  } catch {
    throw new FaceChallengeError();
  }
  const expiresAtMs = typeof parsed.e === 'number' ? parsed.e : Number.NaN;
  if (
    parsed.h !== subjectHash(userId)
    || !ACTIONS.includes(parsed.a as LivenessAction)
    || !Number.isFinite(expiresAtMs)
    || typeof parsed.n !== 'string'
    || expiresAtMs <= now.getTime()
  ) {
    throw new FaceChallengeError();
  }
  return { id, action: parsed.a as LivenessAction, expiresAt: new Date(expiresAtMs) };
}
