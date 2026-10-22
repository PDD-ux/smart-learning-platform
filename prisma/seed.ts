import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

interface SeedUser {
  email: string;
  password: string;
  nickname: string;
  role: 'student' | 'admin';
}

function configuredSeedUser(
  prefix: 'SEED_ADMIN' | 'SEED_DEMO',
  role: SeedUser['role'],
  defaultNickname: string,
): SeedUser | null {
  const email = process.env[`${prefix}_EMAIL`]?.trim() ?? '';
  const password = process.env[`${prefix}_PASSWORD`] ?? '';
  const nickname = process.env[`${prefix}_NICKNAME`]?.trim() || defaultNickname;

  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error(`${prefix}_EMAIL 与 ${prefix}_PASSWORD 必须同时配置`);
  }
  if (password.length < 12) {
    throw new Error(`${prefix}_PASSWORD 长度必须不少于 12 个字符`);
  }
  return { email, password, nickname, role };
}

const seedUsers = [
  configuredSeedUser('SEED_ADMIN', 'admin', '管理员'),
  configuredSeedUser('SEED_DEMO', 'student', '演示学员'),
].filter((user): user is SeedUser => user !== null);

async function main(): Promise<void> {
  if (seedUsers.length === 0) {
    console.info('[seed] skipped: no SEED_ADMIN_* or SEED_DEMO_* credentials configured');
    return;
  }
  for (const user of seedUsers) {
    const passwordHash = await hashPassword(user.password);
    await prisma.user.upsert({
      where: { email: user.email },
      update: { nickname: user.nickname, role: user.role },
      create: {
        email: user.email,
        passwordHash,
        nickname: user.nickname,
        role: user.role,
      },
    });
    console.log(`[seed] upserted user ${user.email} (${user.role})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[seed] failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
