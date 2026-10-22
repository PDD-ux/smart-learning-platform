import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { rateLimit, getClientIp } from '@/lib/api/rate-limit';
import { ApiError } from '@/lib/auth/ownership';
import { issueSession, attachAuthCookies } from '@/lib/auth/session';
import { parseFaceCapture, disposeFaceCaptures, FaceCaptureError, type FaceCapture } from '@/lib/face/capture';
import { faceLogin } from '@/lib/face/login';
import { assertFaceLoginConfigured } from '@/lib/face/verification-provider';

const schema = z.object({
  account: z.string().trim().min(1).max(254),
  challengeId: z.string().min(1).max(2048),
  captures: z.array(z.string().max(1_400_000)).min(2).max(12),
  remember: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await rateLimit(`login:${getClientIp(request)}`, 5, 60_000)).allowed) return fail(ErrorCode.RATE_LIMITED, '登录尝试频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(ErrorCode.FACE_CAPTURE_INVALID, '账号、挑战或采集画面无效，请重新尝试', HttpStatus.BAD_REQUEST);
  const captures: FaceCapture[] = [];
  try {
    assertFaceLoginConfigured();
    for (const capture of parsed.data.captures) captures.push(parseFaceCapture(capture));
    const verified = await faceLogin(parsed.data.account, parsed.data.challengeId, captures);
    const session = issueSession(verified.user, verified.credentialVersion, parsed.data.remember ?? false);
    const redirect = verified.user.role === 'teacher' ? '/teacher' : '/dashboard';
    const response = ok({ user: verified.user, accessToken: session.accessToken, redirect, checkIn: verified.checkIn }, '人脸登录成功，今日已打卡');
    response.headers.set('Cache-Control', 'no-store');
    attachAuthCookies(response, session, parsed.data.remember ?? false);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message, error.status);
    if (error instanceof FaceCaptureError) return fail(ErrorCode.FACE_CAPTURE_INVALID, '采集画面无效，请重新尝试', HttpStatus.BAD_REQUEST);
    // 不打印第三方响应、画面、模板或账号；未知故障关闭认证。
    return fail(ErrorCode.FACE_SERVICE_UNAVAILABLE, '人脸登录暂不可用，请使用密码登录', HttpStatus.SERVICE_UNAVAILABLE);
  } finally { disposeFaceCaptures(captures); }
}
