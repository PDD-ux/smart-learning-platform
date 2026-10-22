import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { parseAccount } from '@/lib/auth/account';
import { issueSession, attachAuthCookies, toPublicUser, passwordVersion } from '@/lib/auth/session';
import { rateLimit, getClientIp } from '@/lib/api/rate-limit';

/**
 * 登录接口（tasks.md §1.4 / §1.6）
 * ------------------------------------------------------------
 * 1. 限流：同一 IP 5 次/分钟（PRD §7.2 / spec/04-DATA-MODEL.md §6.4）
 * 2. zod 校验入参
 * 3. 识别 account（邮箱或手机号）并按对应唯一列查用户 + bcrypt 比对
 * 4. 失败统一返回 INVALID_CREDENTIALS，不区分「账号不存在 / 密码错误」，避免账号枚举
 * 5. 成功签发 JWT + 下发 httpOnly Cookie
 */

const loginSchema = z.object({
  account: z.string().min(1, '请输入邮箱或手机号'),
  password: z.string().min(1, '请输入密码'),
  remember: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  const ip = getClientIp(request);
  const limited = await rateLimit(`login:${ip}`, 5, 60_000);
  if (!limited.allowed) {
    const response = fail(
      ErrorCode.RATE_LIMITED,
      '登录尝试过于频繁，请稍后再试',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfter: limited.retryAfter },
    );
    response.headers.set('Retry-After', String(limited.retryAfter));
    return response;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(ErrorCode.INVALID_JSON, '请求体不是合法 JSON', HttpStatus.BAD_REQUEST);
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const { account: rawAccount, password, remember } = parsed.data;
  const account = parseAccount(rawAccount);

  const user = !account
    ? null
    : account.kind === 'email'
      ? await prisma.user.findUnique({ where: { email: account.value } })
      : await prisma.user.findUnique({ where: { phone: account.value } });

  const passwordMatched = user ? await verifyPassword(password, user.passwordHash) : false;

  // 统一错误：不暴露账号是否存在
  if (!user || !passwordMatched || !['student', 'teacher', 'admin'].includes(user.role)) {
    return fail(ErrorCode.INVALID_CREDENTIALS, '账号或密码不正确', HttpStatus.UNAUTHORIZED);
  }

  const publicUser = toPublicUser(user);
  const session = issueSession(publicUser, passwordVersion(user.passwordHash), remember ?? false);
  const response = ok(
    { user: publicUser, accessToken: session.accessToken, redirect: user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/dashboard' },
    '登录成功',
  );
  attachAuthCookies(response, session, remember ?? false);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
