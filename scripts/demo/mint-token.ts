/**
 * 为指定用户签发一个演练用 access token（绕过登录限流，仅本地演练使用）。
 * 用法：npx tsx scripts/demo/mint-token.ts <email>
 */

import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

import { issueSession, toPublicUser, passwordVersion } from '../../src/lib/auth/session';

// 必须用 .env.local **覆盖** Prisma 自动载入的 .env，否则 JWT 密钥与应用不一致（接口会 401）
function loadEnvOverride(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    process.env[key] = value;
  }
}
loadEnvOverride('.env.local');

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('用法：npx tsx scripts/demo/mint-token.ts <email>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`未找到用户：${email}`);
    process.exit(1);
  }
  const publicUser = toPublicUser(user);
  const session = issueSession(publicUser, passwordVersion(user.passwordHash), true);
  console.log(session.accessToken);
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
