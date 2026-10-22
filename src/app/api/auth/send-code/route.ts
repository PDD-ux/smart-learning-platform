import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, HttpStatus } from '@/lib/api/response';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, getClientIp } from '@/lib/api/rate-limit';
import { parseAccount } from '@/lib/auth/account';
import { generateCode, saveCode, CODE_TTL_SEC } from '@/lib/auth/code-store';

/**
 * 发送验证码（tasks.md §1.4 / §1.6）
 * ------------------------------------------------------------
 * 1. 限流：同一 IP 1 次/分钟（spec/04-DATA-MODEL.md §6.4）
 * 2. 识别 account（邮箱或手机号）并归一化
 * 3. 生成 6 位验证码写入 Redis（TTL 5 分钟），Redis 不可用时降级内存
 * 4. 生产环境绝不回传验证码；非生产环境返回 devCode 方便本地演示
 *
 * 说明：手机号短信 MVP 用 mock（无真实短信网关）；接入厂商时在 `channel==='phone'`
 * 分支调用短信 SDK 即可，验证码存储与校验链路不变。
 */

const schema = z.object({
  account: z.string().min(1, '请输入邮箱或手机号'),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = await rateLimit(`send-code:${ip}`, 1, 60_000);
  if (!limited.allowed) {
    const response = fail(
      ErrorCode.RATE_LIMITED,
      '验证码发送过于频繁，请稍后再试',
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
      '请输入正确的邮箱或手机号',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const account = parseAccount(parsed.data.account);
  if (!account) {
    return fail(ErrorCode.VALIDATION_FAILED, '请输入正确的邮箱或手机号', HttpStatus.BAD_REQUEST);
  }

  const code = generateCode();
  await saveCode(account.value, code);

  return ok(
    {
      sent: true,
      account: account.value,
      channel: account.kind,
      expiresIn: CODE_TTL_SEC,
      // 仅非生产环境回传验证码，方便本地演示；生产环境一律不回传
      ...(process.env.NODE_ENV === 'production' ? {} : { devCode: code }),
    },
    '验证码已发送',
  );
}
