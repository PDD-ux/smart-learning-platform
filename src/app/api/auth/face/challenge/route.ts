import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { rateLimit, getClientIp } from '@/lib/api/rate-limit';
import { ApiError } from '@/lib/auth/ownership';
import { createFaceLoginChallenge } from '@/lib/face/login';
import { assertFaceLoginConfigured } from '@/lib/face/verification-provider';
import { faceLoginMode } from '@/lib/face/login-policy';

const schema = z.object({ account: z.string().trim().min(1).max(254) });

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await rateLimit(`face-login-challenge:${getClientIp(request)}`, 5, 60_000)).allowed) return fail(ErrorCode.RATE_LIMITED, '尝试频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.VALIDATION_FAILED, '请输入有效的邮箱或手机号', HttpStatus.BAD_REQUEST);
  try {
    assertFaceLoginConfigured();
    const challenge = await createFaceLoginChallenge(parsed.data.account);
    const response = ok({ challengeId: challenge.id, action: challenge.action, expiresAt: challenge.expiresAt.toISOString(), verificationMode: faceLoginMode() });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message, error.status);
    return fail(ErrorCode.FACE_SERVICE_UNAVAILABLE, '人脸登录服务尚未接入或暂不可用，请使用密码登录', HttpStatus.SERVICE_UNAVAILABLE);
  }
}
