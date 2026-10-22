import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Redis 不可用 → 强制走内存降级分支，验证降级路径可跑通
vi.mock('@/lib/redis', () => ({
  getRedis: () => {
    throw new Error('redis unavailable (test)');
  },
}));

import {
  parseDurationSec,
  accessTtlSec,
  refreshTtlSec,
  signAccessToken,
  verifyToken,
} from '@/lib/auth/jwt';
import {
  generateCode,
  saveCode,
  verifyAndConsumeCode,
} from '@/lib/auth/code-store';
import {
  issueSession,
  attachAuthCookies,
  clearAuthCookies,
  toPublicUser,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  passwordVersion,
} from '@/lib/auth/session';

/**
 * 认证辅助工具 单测（tasks.md §1.4）
 * ------------------------------------------------------------
 * 覆盖：JWT 时长解析、验证码存储/一次性消费、会话签发与 Cookie 下发。
 */

describe('jwt.parseDurationSec', () => {
  it('parses seconds / minutes / hours / days', () => {
    expect(parseDurationSec('10s', 999)).toBe(10);
    expect(parseDurationSec('15m', 999)).toBe(900);
    expect(parseDurationSec('2h', 999)).toBe(7_200);
    expect(parseDurationSec('30d', 999)).toBe(2_592_000);
    expect(parseDurationSec('3600', 999)).toBe(3_600);
  });

  it('falls back when the value is unparseable', () => {
    expect(parseDurationSec('', 123)).toBe(123);
    expect(parseDurationSec('forever', 123)).toBe(123);
  });

  it('exposes env defaults (15m / 30d)', () => {
    expect(accessTtlSec()).toBe(900);
    expect(refreshTtlSec()).toBe(2_592_000);
  });
});

describe('code-store', () => {
  beforeEach(() => {
    // 清理可能残留的内存记录（globalThis 单例）
    const store = (globalThis as unknown as { __slpCodeStore?: Map<string, unknown> }).__slpCodeStore;
    store?.clear();
  });

  it('generates a 6-digit code', () => {
    expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('verifies a saved code once, then reports not_sent (one-time consume)', async () => {
    await saveCode('user@test.com', '123456');
    expect(await verifyAndConsumeCode('user@test.com', '123456')).toBe('ok');
    expect(await verifyAndConsumeCode('user@test.com', '123456')).toBe('not_sent');
  });

  it('reports mismatch for a wrong code and consumes it', async () => {
    await saveCode('user@test.com', '123456');
    expect(await verifyAndConsumeCode('user@test.com', '000000')).toBe('mismatch');
    expect(await verifyAndConsumeCode('user@test.com', '123456')).toBe('not_sent');
  });

  it('reports not_sent when no code was requested', async () => {
    expect(await verifyAndConsumeCode('nobody@test.com', '123456')).toBe('not_sent');
  });

  it('reports expired for a stale code', async () => {
    await saveCode('user@test.com', '123456', -1);
    expect(await verifyAndConsumeCode('user@test.com', '123456')).toBe('expired');
  });

  it('normalizes email casing', async () => {
    await saveCode('User@Test.com', '123456');
    expect(await verifyAndConsumeCode('user@test.com', '123456')).toBe('ok');
  });
});

describe('session', () => {
  const user = { id: 'usr_1', email: 'a@b.com', phone: null, nickname: '小明', role: 'student' };

  it('issues verifiable access / refresh tokens for the same subject', () => {
    const { accessToken, refreshToken } = issueSession(user, passwordVersion('test-hash'));
    expect(verifyToken(accessToken).sub).toBe('usr_1');
    expect(verifyToken(refreshToken).sub).toBe('usr_1');
  });

  it('attaches httpOnly access / refresh cookies', () => {
    const res = NextResponse.json({});
    attachAuthCookies(res, issueSession(user, passwordVersion('test-hash')), false);
    const access = res.cookies.get(ACCESS_COOKIE);
    const refresh = res.cookies.get(REFRESH_COOKIE);
    expect(access?.value).toBeTruthy();
    expect(access?.httpOnly).toBe(true);
    expect(refresh?.value).toBeTruthy();
    expect(refresh?.maxAge).toBe(2 * 3_600);
  });

  it('extends refresh cookie lifetime when remember=true', () => {
    const res = NextResponse.json({});
    attachAuthCookies(res, issueSession(user, passwordVersion('test-hash'), true), true);
    expect(res.cookies.get(REFRESH_COOKIE)?.maxAge).toBe(2_592_000);
  });

  it('clears auth cookies on logout', () => {
    const res = NextResponse.json({});
    clearAuthCookies(res);
    expect(res.cookies.get(ACCESS_COOKIE)?.maxAge).toBe(0);
    expect(res.cookies.get(REFRESH_COOKIE)?.maxAge).toBe(0);
  });

  it('toPublicUser strips sensitive fields', () => {
    const withSecret = { ...user, passwordHash: 'secret' };
    const publicUser = toPublicUser(withSecret);
    expect(publicUser).toEqual(user);
    expect('passwordHash' in publicUser).toBe(false);
  });
});
