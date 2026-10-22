import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  verifyCode: vi.fn(),
  saveCode: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUnique, create: mocks.create } },
}));

vi.mock('@/lib/auth/code-store', () => ({
  generateCode: () => '123456',
  saveCode: mocks.saveCode,
  verifyAndConsumeCode: mocks.verifyCode,
  CODE_TTL_SEC: 300,
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock('@/lib/api/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfter: 0 })),
  getClientIp: () => '127.0.0.1',
}));

import { POST as register } from '@/app/api/auth/register/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as sendCode } from '@/app/api/auth/send-code/route';

/**
 * 手机号账号认证 单测（tasks.md §1.6）
 */

function req(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PHONE = '13800138000';

describe('POST /api/auth/send-code (phone)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a code keyed by the normalized phone and returns the channel', async () => {
    const res = await sendCode(req('http://localhost/api/auth/send-code', { account: '138 0013 8000' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ sent: true, account: PHONE, channel: 'phone' });
    expect(mocks.saveCode).toHaveBeenCalledWith(PHONE, '123456');
  });

  it('rejects an invalid account', async () => {
    const res = await sendCode(req('http://localhost/api/auth/send-code', { account: 'bad' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCode.mockResolvedValue('ok');
    mocks.hashPassword.mockResolvedValue('hashed');
    mocks.create.mockResolvedValue({
      id: 'u1',
      email: null,
      phone: PHONE,
      nickname: '小明',
      role: 'student',
    });
  });

  it('creates a phone-only account', async () => {
    const res = await register(
      req('http://localhost/api/auth/register', {
        account: PHONE,
        code: '123456',
        nickname: '小明',
        password: 'Password1',
        confirm: 'Password1',
        agree: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user).toMatchObject({ phone: PHONE, email: null });
    expect(mocks.verifyCode).toHaveBeenCalledWith(PHONE, '123456');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: null, phone: PHONE }) }),
    );
  });

  it('returns PHONE_TAKEN on a phone uniqueness conflict', async () => {
    mocks.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['phone'] },
      }),
    );
    const res = await register(
      req('http://localhost/api/auth/register', {
        account: PHONE,
        code: '123456',
        nickname: '小明',
        password: 'Password1',
        confirm: 'Password1',
        agree: true,
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PHONE_TAKEN');
  });

  it('returns EMAIL_TAKEN on an email uniqueness conflict', async () => {
    mocks.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );
    const res = await register(
      req('http://localhost/api/auth/register', {
        account: 'a@b.com',
        code: '123456',
        nickname: '小明',
        password: 'Password1',
        confirm: 'Password1',
        agree: true,
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('EMAIL_TAKEN');
  });
});

describe('POST /api/auth/login (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPassword.mockResolvedValue(true);
  });

  it('looks up the user by phone and signs a session', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'u1',
      email: null,
      phone: PHONE,
      nickname: '小明',
      role: 'student',
      passwordHash: 'hashed',
    });
    const res = await login(req('http://localhost/api/auth/login', { account: PHONE, password: 'x' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ user: { phone: PHONE, role: 'student' }, redirect: '/dashboard' });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { phone: PHONE } });
  });

  it('sends administrators to the management center after login', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      phone: null,
      nickname: '平台管理员',
      role: 'admin',
      passwordHash: 'hashed',
    });

    const res = await login(req('http://localhost/api/auth/login', { account: 'admin@example.com', password: 'x' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.redirect).toBe('/admin');
  });

  it('sends a password-authenticated teacher to the teacher workspace', async (): Promise<void> => {
    mocks.findUnique.mockResolvedValue({ id: 'teacher-1', email: 'teacher@example.com', phone: null, nickname: '授课教师', role: 'teacher', passwordHash: 'hashed' });
    const response = await login(req('http://localhost/api/auth/login', { account: 'teacher@example.com', password: 'x' }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ user: { role: 'teacher' }, redirect: '/teacher' });
  });

  it('looks up the user by email', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      phone: null,
      nickname: '小明',
      role: 'student',
      passwordHash: 'hashed',
    });
    await login(req('http://localhost/api/auth/login', { account: 'A@B.com', password: 'x' }));
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
  });

  it('rejects an unrecognized account without querying', async () => {
    const res = await login(req('http://localhost/api/auth/login', { account: 'bad', password: 'x' }));
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
