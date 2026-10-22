import { NextRequest } from 'next/server';

import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { withAuth } from '@/lib/auth/middleware';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { requestManualAttendance } from '@/lib/face/face-service';
import { assertFaceEnabledUser } from '@/lib/face/daily-check-in';

/** 不要求摄像头或模板；只创建待管理员确认的最小签到记录。 */
export const POST = withAuth(async (request: NextRequest, { user }) => {
  await assertFaceEnabledUser(user.id);
  const limited = await rateLimit(`face:manual:${user.id}`, RateLimitPolicy.face.limit, RateLimitPolicy.face.windowMs);
  if (!limited.allowed) {
    return fail(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, { retryAfter: limited.retryAfter });
  }
  return ok(await requestManualAttendance(user.id, request), '已提交人工确认申请');
});
