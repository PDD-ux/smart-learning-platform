import { describe, expect, it } from 'vitest';

import {
  isEmail,
  isPhone,
  normalizeEmail,
  normalizePhone,
  parseAccount,
} from '@/lib/auth/account';

/**
 * 账号标识工具 单测（tasks.md §1.6）
 */

describe('parseAccount', () => {
  it('recognizes and normalizes emails', () => {
    expect(parseAccount('  User@Test.COM ')).toEqual({ kind: 'email', value: 'user@test.com' });
  });

  it('recognizes and normalizes mainland phone numbers', () => {
    expect(parseAccount('138 0013 8000')).toEqual({ kind: 'phone', value: '13800138000' });
    expect(parseAccount('138-0013-8000')).toEqual({ kind: 'phone', value: '13800138000' });
  });

  it('rejects invalid accounts', () => {
    expect(parseAccount('')).toBeNull();
    expect(parseAccount('not-an-account')).toBeNull();
    expect(parseAccount('12345')).toBeNull();
    expect(parseAccount('23800138000')).toBeNull(); // 不以 1[3-9] 开头
  });
});

describe('isEmail / isPhone', () => {
  it('validates emails', () => {
    expect(isEmail('a@b.com')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
  });

  it('validates phone numbers', () => {
    expect(isPhone('13800138000')).toBe(true);
    expect(isPhone('138 0013 8000')).toBe(true);
    expect(isPhone('1380013800')).toBe(false);
  });
});

describe('normalize', () => {
  it('lowercases and trims emails', () => {
    expect(normalizeEmail(' A@B.Com ')).toBe('a@b.com');
  });

  it('strips spaces and dashes from phones', () => {
    expect(normalizePhone(' 138-0013-8000 ')).toBe('13800138000');
  });
});
