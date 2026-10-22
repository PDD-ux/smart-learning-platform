import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { getClientIp, rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { withAuth } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { disposeFaceCaptures, FaceCaptureError, parseFaceCapture } from '@/lib/face/capture';
import { enrollFaceTemplate } from '@/lib/face/face-service';
import { LOGIN_CONSENT_VERSION } from '@/lib/face/login';
import { assertFaceEnabledUser } from '@/lib/face/daily-check-in';

const enrollSchema = z.object({
  consent: z.literal(true),
  consentVersion: z.string().trim().min(1).max(120),
  captures: z.array(z.string().max(1_400_000)).min(1).max(3),
});

export const POST = withAuth(async (request: NextRequest, { user }) => {
  await assertFaceEnabledUser(user.id);
  const limited = await rateLimit(`face:enroll:${user.id}`, RateLimitPolicy.face.limit, RateLimitPolicy.face.windowMs);
  if (!limited.allowed) {
    return fail(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, {
      retryAfter: limited.retryAfter,
    });
  }
  const parsed = enrollSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const consentMissing = parsed.error.issues.some((issue) => issue.path[0] === 'consent');
    return fail(
      consentMissing ? ErrorCode.FACE_CONSENT_REQUIRED : ErrorCode.FACE_CAPTURE_INVALID,
      consentMissing ? '请先阅读并同意人脸信息处理说明' : '录入画面或授权版本无效',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (parsed.data.consentVersion !== LOGIN_CONSENT_VERSION) {
    return fail(ErrorCode.FACE_CONSENT_REQUIRED, '请重新阅读并同意当前人脸登录授权', HttpStatus.BAD_REQUEST);
  }

  let captures = [] as ReturnType<typeof parseFaceCapture>[];
  try {
    for (const capture of parsed.data.captures) captures.push(parseFaceCapture(capture));
    const status = await enrollFaceTemplate({
      userId: user.id,
      consentVersion: parsed.data.consentVersion,
      captures,
      ip: getClientIp(request),
    });
    return ok(status, '人脸特征已加密保存', 201);
  } catch (error) {
    if (error instanceof FaceCaptureError) {
      return fail(ErrorCode.FACE_CAPTURE_INVALID, '录入画面无效', HttpStatus.BAD_REQUEST);
    }
    if (error instanceof ApiError) throw error;
    throw error;
  } finally {
    disposeFaceCaptures(captures);
  }
});
