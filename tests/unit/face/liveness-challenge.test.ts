import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FaceChallengeError,
  issueLivenessChallenge,
  verifyLivenessChallenge,
} from '@/lib/face/liveness-challenge';

describe('liveness challenge', () => {
  beforeEach(() => {
    vi.stubEnv('FACE_CHALLENGE_SECRET', 'test-face-challenge-secret-with-at-least-thirty-two-characters');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds a short-lived challenge to the issuing user and action', () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    const issued = issueLivenessChallenge('user-1', now);
    const verified = verifyLivenessChallenge('user-1', issued.id, new Date('2026-09-24T00:01:00.000Z'));
    expect(verified.action).toBe(issued.action);
    expect(verified.expiresAt.toISOString()).toBe('2026-09-24T00:02:00.000Z');
    expect(() => verifyLivenessChallenge('user-2', issued.id, now)).toThrow(FaceChallengeError);
  });

  it('rejects altered and expired challenge IDs', () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    const issued = issueLivenessChallenge('user-1', now);
    expect(() => verifyLivenessChallenge('user-1', `${issued.id}x`, now)).toThrow(FaceChallengeError);
    expect(() => verifyLivenessChallenge('user-1', issued.id, new Date('2026-09-24T00:02:00.000Z'))).toThrow(FaceChallengeError);
  });
});
