import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  );
  console.log('=== 有数据的表 ===');
  for (const t of tables) {
    try {
      const r = await prisma.$queryRawUnsafe<Array<{ c: number }>>(`SELECT COUNT(*)::int AS c FROM "${t.table_name}"`);
      if (r[0].c > 0) console.log(`${t.table_name}: ${r[0].c}`);
    } catch {
      /* 忽略无权限表 */
    }
  }

  console.log('\n=== 用户 ===');
  const users = await prisma.user.findMany({
    select: { id: true, email: true, nickname: true, role: true },
    take: 30,
  });
  console.table(users);

  console.log('\n=== 学习内容（前 20）===');
  const contents = await prisma.learningContent.findMany({
    select: { id: true, title: true, contentType: true, understandingStatus: true, durationSec: true, ownerId: true },
    take: 20,
  });
  console.table(contents);

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
