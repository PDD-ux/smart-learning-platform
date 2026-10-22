/**
 * 演示账号准备脚本（可重复执行）
 * ------------------------------------------------------------
 * 目标：让「给老师演示」时有一个密码已知、且**数据丰富**的学员账号。
 *
 * 背景：
 *   - 库里数据最丰富的学员（默认取内容最多的那位）是人脸注册的，没有邮箱/手机号，
 *     因此无法用账号密码登录，演示现场很不方便；
 *   - 本脚本给它绑定邮箱 demo@wenhao.local 与固定密码，昵称改为「演示学员」；
 *   - 人脸登录按 userId 匹配 FaceTemplate，绑邮箱不会影响原有的人脸登录。
 *   - 若 demo@wenhao.local 已被另一个空账号占用，会把那个空账号改名释放邮箱（不删除数据）。
 *
 * 同时确保管理员演示账号 demo-admin@wenhao.local 存在。
 *
 * 用法：npx tsx scripts/demo/prepare-demo-account.ts
 * 可选：DEMO_PASSWORD=xxx 覆盖默认密码
 */

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../../src/lib/auth/password';

const prisma = new PrismaClient();

const DEMO_STUDENT_EMAIL = 'demo@wenhao.local';
const DEMO_ADMIN_EMAIL = 'demo-admin@wenhao.local';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo12345';
const FALLBACK_EMAIL = 'demo-spare@wenhao.local';

async function main(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // 1. 找出数据最丰富的学员
  const grouped = await prisma.learningContent.groupBy({
    by: ['ownerId'],
    _count: { _all: true },
    orderBy: { _count: { ownerId: 'desc' } },
    take: 10,
  });
  let targetId = '';
  let targetName = '';
  let targetCount = 0;
  for (const row of grouped) {
    const user = await prisma.user.findUnique({ where: { id: row.ownerId } });
    if (user && user.role !== 'admin') {
      targetId = user.id;
      targetName = user.nickname;
      targetCount = row._count._all;
      break;
    }
  }
  if (!targetId) {
    console.error('未找到任何有学习资料的学员，请先导入一份资料');
    process.exit(1);
  }
  console.log(`[student] 目标学员：${targetName}（${targetCount} 份资料）`);

  // 2. 释放邮箱：若 demo@wenhao.local 被其他账号占用，先给它换个邮箱（保留数据）
  const occupant = await prisma.user.findUnique({ where: { email: DEMO_STUDENT_EMAIL } });
  if (occupant && occupant.id !== targetId) {
    let spare = FALLBACK_EMAIL;
    const spareTaken = await prisma.user.findUnique({ where: { email: spare } });
    if (spareTaken) spare = `demo-spare-${Date.now()}@wenhao.local`;
    await prisma.user.update({ where: { id: occupant.id }, data: { email: spare } });
    console.log(`[student] 原 ${DEMO_STUDENT_EMAIL} 占用者改为 ${spare}（数据保留）`);
  }

  // 3. 绑定演示邮箱与密码
  await prisma.user.update({
    where: { id: targetId },
    data: { email: DEMO_STUDENT_EMAIL, passwordHash, nickname: '演示学员' },
  });
  console.log(`[student] ${targetName} → ${DEMO_STUDENT_EMAIL} / ${DEMO_PASSWORD}（昵称：演示学员）`);

  // 4. 管理员演示账号
  const admin = await prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: { passwordHash, role: 'admin', nickname: '演示管理员' },
    create: { email: DEMO_ADMIN_EMAIL, passwordHash, role: 'admin', nickname: '演示管理员' },
  });
  console.log(`[admin] ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD} -> ${admin.id}`);

  console.log(`\n演示密码统一为：${DEMO_PASSWORD}`);
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
