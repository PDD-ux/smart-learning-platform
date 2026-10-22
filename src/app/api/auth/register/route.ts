import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ok, fail, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { parseAccount } from '@/lib/auth/account';
import { verifyAndConsumeCode } from '@/lib/auth/code-store';
import { issueSession, attachAuthCookies, toPublicUser, passwordVersion } from '@/lib/auth/session';
import { rateLimit, getClientIp } from '@/lib/api/rate-limit';

/**
 * 注册接口（tasks.md §1.4 / §1.6）
 * ------------------------------------------------------------
 * 真实数据库用户校验链路：
 *   1. 限流：同一 IP 5 次/分钟
 *   2. zod 校验入参
 *   3. 识别 account（邮箱或手机号）并归一化
 *   4. 校验并消费验证码（一次性）
 *   5. 唯一性检查（EMAIL_TAKEN / PHONE_TAKEN）
 *   6. bcrypt(cost=12) 哈希口令并写入 users 表（email 或 phone 二选一）
 *   7. 签发 JWT + 下发 httpOnly Cookie
 *
 * 安全约束：绝不把 password / passwordHash 写入日志或响应。
 */

const schema = z
  .object({
    account: z.string().min(1, '请输入邮箱或手机号'),
    code: z.string().regex(/^\d{6}$/, '验证码为 6 位数字'),
    nickname: z.string().min(2, '昵称至少 2 个字').max(20, '昵称最多 20 个字'),
    password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
    confirm: z.string(),
    agree: z.literal(true, { errorMap: () => ({ message: '请先阅读并同意用户协议' }) }),
  })
  .refine((v) => v.password === v.confirm, {
    message: '两次输入的密码不一致',
    path: ['confirm'],
  });

export async function POST(request: NextRequest): Promise<Response> {
  const ip = getClientIp(request);
  const limited = await rateLimit(`register:${ip}`, 5, 60_000);
  if (!limited.allowed) {
    const response = fail(
      ErrorCode.RATE_LIMITED,
      '操作过于频繁，请稍后再试',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfter: limited.retryAfter },
    );
    response.headers.set('Retry-After', String(limited.retryAfter));
    return response;
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const { account: rawAccount, code, nickname, password } = parsed.data;
  const account = parseAccount(rawAccount);
  if (!account) {
    return fail(ErrorCode.VALIDATION_FAILED, '请输入正确的邮箱或手机号', HttpStatus.BAD_REQUEST);
  }

  // 先消费验证码（证明账号归属），避免无验证码探测账号是否已注册
  const codeResult = await verifyAndConsumeCode(account.value, code);
  if (codeResult !== 'ok') {
    if (codeResult === 'expired') {
      return fail(ErrorCode.CODE_EXPIRED, '验证码已过期，请重新获取', HttpStatus.BAD_REQUEST);
    }
    if (codeResult === 'mismatch') {
      return fail(ErrorCode.CODE_MISMATCH, '验证码不正确', HttpStatus.BAD_REQUEST);
    }
    return fail(ErrorCode.CODE_NOT_SENT, '请先获取验证码', HttpStatus.BAD_REQUEST);
  }

  const passwordHash = await hashPassword(password);

  let user: {
    id: string;
    email: string | null;
    phone: string | null;
    nickname: string;
    role: string;
  };
  try {
    user = await prisma.user.create({
      data: {
        email: account.kind === 'email' ? account.value : null,
        phone: account.kind === 'phone' ? account.value : null,
        passwordHash,
        nickname,
        role: 'student',
      },
      select: { id: true, email: true, phone: true, nickname: true, role: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]) : [];
      if (target.includes('phone')) {
        return fail(ErrorCode.PHONE_TAKEN, '该手机号已注册，请直接登录', HttpStatus.CONFLICT);
      }
      return fail(ErrorCode.EMAIL_TAKEN, '该邮箱已注册，请直接登录', HttpStatus.CONFLICT);
    }
    if (err instanceof Prisma.PrismaClientInitializationError) {
      const message = process.env.NODE_ENV === 'development'
        ? '本地数据库未启动，请先启动 PostgreSQL 或配置 DATABASE_URL'
        : '注册服务暂时不可用，请稍后再试';
      return fail(ErrorCode.INTERNAL, message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    throw err;
  }

  const publicUser = toPublicUser(user);
  const session = issueSession(publicUser, passwordVersion(passwordHash));
  const response = ok(
    { user: publicUser, accessToken: session.accessToken, redirect: '/dashboard' },
    '注册成功',
  );
  attachAuthCookies(response, session, false);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
