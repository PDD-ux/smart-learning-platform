import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { getClientIp, rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { withAuth } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { disposeFaceCaptures, FaceCaptureError, parseFaceCapture } from '@/lib/face/capture';
import { verifyFaceAttendance } from '@/lib/face/face-service';
import { assertFaceEnabledUser } from '@/lib/face/daily-check-in';

const verifySchema = z.object({
  challengeId: z.string().trim().min(1).max(256),
  captures: z.array(z.string().max(1_400_000)).min(1).max(3),
});

export const POST = withAuth(async (request: NextRequest, { user }) => {
  await assertFaceEnabledUser(user.id);
  const limited = await rateLimit(`face:verify:${user.id}`, RateLimitPolicy.face.limit, RateLimitPolicy.face.windowMs);
  if (!limited.allowed) {
    return fail(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, {
      retryAfter: limited.retryAfter,
    });
  }
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.FACE_CAPTURE_INVALID, '验证画面或活体挑战无效', HttpStatus.BAD_REQUEST);

  let captures = [] as ReturnType<typeof parseFaceCapture>[];
  try {
    captures = parsed.data.captures.map(parseFaceCapture);
    const result = await verifyFaceAttendance({
      userId: user.id,
      challengeId: parsed.data.challengeId,
      captures,
      ip: getClientIp(request),
    });
    if (result.reason === 'COOLDOWN') {
      return fail(ErrorCode.FACE_ATTENDANCE_COOLDOWN, '验证尝试次数过多，请稍后使用普通签到', HttpStatus.TOO_MANY_REQUESTS);
    }
    return ok(result, result.status === 'signed_in' ? '签到成功' : '请使用普通签到或联系管理员确认');
  } catch (error) {
    if (error instanceof FaceCaptureError) return fail(ErrorCode.FACE_CAPTURE_INVALID, '验证画面无效', HttpStatus.BAD_REQUEST);
    if (error instanceof ApiError) throw error;
    throw error;
  } finally {
    disposeFaceCaptures(captures);
  }
});
