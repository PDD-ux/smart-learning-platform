import { NextRequest } from 'next/server';
import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { rateLimit } from '@/lib/api/rate-limit';
import { withAuth } from '@/lib/auth/middleware';
import { assertFaceEnabledUser, getDailyCheckIn, writeDailyCheckIn } from '@/lib/face/daily-check-in';

export const GET = withAuth(async (_request: NextRequest, { user }): Promise<Response> => {
  await assertFaceEnabledUser(user.id);
  const response = ok(await getDailyCheckIn(user.id));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export const POST = withAuth(async (_request: NextRequest, { user }): Promise<Response> => {
  await assertFaceEnabledUser(user.id);
  if (!(await rateLimit(`check-in:${user.id}`, 10, 60_000)).allowed) {
    return fail(ErrorCode.RATE_LIMITED, '操作频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }
  return ok(await writeDailyCheckIn(user.id, 'manual', 'self-check-in-v1'), '今日打卡完成');
});
