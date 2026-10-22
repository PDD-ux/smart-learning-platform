import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { assertAdmin } from '@/lib/auth/admin';
import { parseAccount } from '@/lib/auth/account';
import { hashPassword } from '@/lib/auth/password';
import { withAuth } from '@/lib/auth/middleware';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { prisma } from '@/lib/prisma';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  query: z.string().trim().max(80).default(''),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
});

const createSchema = z.object({
  account: z.string().min(1, '请输入邮箱或手机号'),
  nickname: z.string().min(2, '昵称至少 2 个字').max(20, '昵称最多 20 个字'),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
  role: z.enum(['admin', 'teacher', 'student']),
});

type UserRecord = {
  id: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

function toAdminUser(user: UserRecord, currentUserId: string) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    nickname: user.nickname,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    isCurrent: user.id === currentUserId,
  };
}

export const GET = withAuth(async (request: NextRequest, { user }) => {
  await assertAdmin(user);
  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    query: searchParams.get('query') ?? '',
    role: searchParams.get('role') ?? undefined,
  });
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_FAILED, '查询参数校验未通过', HttpStatus.BAD_REQUEST, parsed.error.flatten().fieldErrors);
  }

  const { page, pageSize, query, role } = parsed.data;
  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role;
  if (query) {
    where.OR = [
      { email: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query } },
      { nickname: { contains: query, mode: 'insensitive' } },
    ];
  }
  const select = { id: true, email: true, phone: true, nickname: true, role: true, createdAt: true, updatedAt: true } as const;
  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return ok({ page, pageSize, total, items: items.map((item) => toAdminUser(item, user.id)) });
});

export const POST = withAuth(async (request: NextRequest, { user }) => {
  await assertAdmin(user);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_FAILED, '用户信息校验未通过', HttpStatus.BAD_REQUEST, parsed.error.flatten().fieldErrors);
  }
  const account = parseAccount(parsed.data.account);
  if (!account) return fail(ErrorCode.VALIDATION_FAILED, '请输入正确的邮箱或手机号', HttpStatus.BAD_REQUEST);

  try {
    const created = await prisma.user.create({
      data: {
        email: account.kind === 'email' ? account.value : null,
        phone: account.kind === 'phone' ? account.value : null,
        nickname: parsed.data.nickname,
        passwordHash: await hashPassword(parsed.data.password),
        role: parsed.data.role,
      },
      select: { id: true, email: true, phone: true, nickname: true, role: true, createdAt: true, updatedAt: true },
    });
    return ok({ user: toAdminUser(created, user.id) }, '用户创建成功', 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return fail(account.kind === 'phone' ? ErrorCode.PHONE_TAKEN : ErrorCode.EMAIL_TAKEN, account.kind === 'phone' ? '该手机号已注册' : '该邮箱已注册', HttpStatus.CONFLICT);
    }
    throw error;
  }
});
