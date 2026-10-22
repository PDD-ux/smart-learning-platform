import bcrypt from 'bcryptjs';

/**
 * 口令加盐哈希工具（bcrypt，cost ≥ 12）
 * ------------------------------------------------------------
 * 替换历史分支中仅用于演示的 password.ts 密码强度实现（tasks.md 1.4）。
 */

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}