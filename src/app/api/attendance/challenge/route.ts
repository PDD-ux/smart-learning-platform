import { NextRequest } from 'next/server';

import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { withAuth } from '@/lib/auth/middleware';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { FaceChallengeError, issueLivenessChallenge } from '@/lib/face/liveness-challenge';
import { assertFaceEnabledUser } from '@/lib/face/daily-check-in';

/** 签发一次性、两分钟过期且绑定当前用户的基础活体动作。 */
export const POST = withAuth(async (_request: NextRequest, { user }) => {
  await assertFaceEnabledUser(user.id);
  const limited = await rateLimit(`face:challenge:${user.id}`, RateLimitPolicy.face.limit, RateLimitPolicy.face.windowMs);
  if (!limited.allowed) {
    return fail(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, {
      retryAfter: limited.retryAfter,
    });
  }
  try {
    const challenge = issueLivenessChallenge(user.id);
    return ok({ challengeId: challenge.id, action: challenge.action, expiresAt: challenge.expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof FaceChallengeError) {
      return fail(ErrorCode.FACE_SERVICE_UNAVAILABLE, '活体挑战服务暂不可用，请使用普通签到', HttpStatus.SERVICE_UNAVAILABLE);
    }
    throw error;
  }
});
