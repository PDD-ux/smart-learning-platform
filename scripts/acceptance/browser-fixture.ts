import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '@next/env';
import { hashPassword } from '../../src/lib/auth/password';
import { getStorage, buildContentKey, cleanupContentObjects } from '../../src/lib/storage';
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
async function main(): Promise<void> {
  const [mode, runId] = process.argv.slice(2);
  if (!/^[a-z0-9-]{8,80}$/.test(runId ?? '') || !['setup', 'cleanup'].includes(mode)) throw new Error('需要 setup|cleanup 和独立 runId');
  const ownerId = 'ui-acceptance-' + runId;
  try {
    if (mode === 'cleanup') {
      const contents = await prisma.learningContent.findMany({ where: { ownerId }, select: { id: true } });
      for (const content of contents) await cleanupContentObjects(content.id);
      await prisma.user.deleteMany({ where: { id: ownerId } });
      console.log(JSON.stringify({ status: 'cleaned', contents: contents.length })); return;
    }
    const password = process.env.UI_ACCEPTANCE_PASSWORD;
    if (!password || password.length < 12) throw new Error('仅通过临时环境变量提供 UI_ACCEPTANCE_PASSWORD');
    await prisma.user.create({ data: { id: ownerId, email: ownerId + '@example.com', nickname: '隔离浏览器验收', passwordHash: await hashPassword(password) } });
    const text = '隔离页面验收资料。梯度由偏导数组成，用于确定函数增长最快的方向。';
    const content = await prisma.learningContent.create({ data: { ownerId, contentType: 'DOCUMENT', title: '页面验收 · 梯度讲义', fileName: 'gradient.txt', format: 'TXT', fileSizeBytes: BigInt(Buffer.byteLength(text)), storageKey: 'pending', status: 'READY', understandingStatus: 'COMPLETED', pageCount: 1 } });
    const key = buildContentKey(content.id, 'gradient.txt');
    await getStorage().putObject(key, Buffer.from(text), { contentType: 'text/plain' });
    await prisma.learningContent.update({ where: { id: content.id }, data: { storageKey: key } });
    await prisma.textBlock.create({ data: { contentId: content.id, source: 'MD', sequence: 0, ref: { type: 'document', page: 1 }, text } });
    const point = await prisma.knowledgePoint.create({ data: { contentId: content.id, ownerId, title: '梯度', summary: text, tags: ['数学'], importance: 3, refs: [{ type: 'document', page: 1 }] } });
    await prisma.generatedNote.create({ data: { contentId: content.id, markdown: '# 页面验收讲义\n\n梯度由偏导数组成。', sourceCount: 1 } });
    await prisma.exercise.create({ data: { contentId: content.id, pointId: point.id, type: 'SINGLE_CHOICE', question: '梯度由什么组成？', options: ['偏导数', '常量'], correctAnswer: '偏导数', explanation: '梯度由函数各方向的偏导数组成。' } });
    console.log(JSON.stringify({ status: 'ready', contentId: content.id, account: ownerId + '@example.com', fixture: '人工测试数据，未调用 AI' }));
  } finally { await prisma.$disconnect(); }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '验收数据操作失败'); process.exitCode = 1; });

