/**
 * 账号标识工具（tasks.md §1.6）
 * ------------------------------------------------------------
 * 账号可为邮箱或手机号（中国大陆手机号），统一识别与归一化：
 *   - 邮箱：trim + 小写
 *   - 手机号：去空格/连字符，校验 `1[3-9]\d{9}`
 */

export type AccountKind = 'email' | 'phone';

export type ParsedAccount = {
  kind: AccountKind;
  /** 归一化后的账号值（用于查库 / 验证码键） */
  value: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizePhone(input: string): string {
  return input.trim().replace(/[\s-]/g, '');
}

export function isEmail(input: string): boolean {
  return EMAIL_RE.test(input.trim());
}

export function isPhone(input: string): boolean {
  return PHONE_RE.test(normalizePhone(input));
}

/** 识别账号类型并归一化；无法识别返回 null */
export function parseAccount(input: string): ParsedAccount | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (EMAIL_RE.test(raw)) return { kind: 'email', value: normalizeEmail(raw) };
  const phone = normalizePhone(raw);
  if (PHONE_RE.test(phone)) return { kind: 'phone', value: phone };
  return null;
}
