import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';
import { buildContentKey, cleanupContentObjects, getStorage } from '../../src/lib/storage';

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [mode, runId] = process.argv.slice(2);
  if (!/^[a-z0-9-]{8,80}$/.test(runId ?? '') || !['setup', 'cleanup', 'verify'].includes(mode)) throw new Error('需要 setup|verify|cleanup 与独立 runId');
  const ownerId = `playback-acceptance-${runId}`;
  try {
    if (mode === 'cleanup') {
      const contents = await prisma.learningContent.findMany({ where: { ownerId }, select: { id: true } });
      for (const content of contents) await cleanupContentObjects(content.id);
      await prisma.user.deleteMany({ where: { id: ownerId } });
      console.log(JSON.stringify({ status: 'cleaned', contents: contents.length })); return;
    }
    if (mode === 'verify') {
      const notes = await prisma.note.findMany({ where: { ownerId }, select: { content: true, ref: true } });
      const progress = await prisma.learningProgress.findMany({ where: { learnerId: ownerId }, select: { ref: true } });
      console.log(JSON.stringify({ fixture: '人工播放验收', notes, progress })); return;
    }
    const password = process.env.UI_ACCEPTANCE_PASSWORD;
    if (!password || password.length < 12) throw new Error('通过临时 UI_ACCEPTANCE_PASSWORD 提供密码');
    const video = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.com`, nickname: '同步笔记隔离验收', passwordHash: await hashPassword(password) } });
    const content = await prisma.learningContent.create({ data: { ownerId, contentType: 'VIDEO', title: '播放同步测试视频（人工测试）', fileName: 'playback-test.mp4', format: 'MP4', fileSizeBytes: BigInt(video.length), storageKey: 'pending', durationSec: 40, status: 'READY', understandingStatus: 'COMPLETED' } });
    const key = buildContentKey(content.id, 'playback-test.mp4');
    await getStorage().putObject(key, video, { contentType: 'video/mp4' });
    await prisma.learningContent.update({ where: { id: content.id }, data: { storageKey: key } });
    for (const [time, title, summary] of [[5, '第一重点 · 梯度方向', '人工测试：沿负梯度方向更新。'], [20, '第二重点 · 学习率', '人工测试：学习率过大可能越过最小值。']] as const) {
      await prisma.knowledgePoint.create({ data: { contentId: content.id, ownerId, title, summary, importance: 3, tags: ['人工测试'], refs: [{ type: 'video', timestampSec: time }] } });
    }
    await prisma.transcriptSegment.createMany({ data: [{ contentId: content.id, seq: 0, startMs: 5000, endMs: 15000, text: '人工转写测试：现在说明梯度方向。' }, { contentId: content.id, seq: 1, startMs: 20000, endMs: 35000, text: '人工转写测试：现在说明学习率。' }] });
    await prisma.generatedNote.create({ data: { contentId: content.id, markdown: '# 人工同步验收笔记\n\n梯度方向与学习率。', sourceCount: 2 } });
    console.log(JSON.stringify({ status: 'ready', contentId: content.id, account: `${ownerId}@example.com`, fixture: '合成视频和人工知识点，不计真实 AI/ASR 验收' }));
  } finally { await prisma.$disconnect(); }
}

void main().catch((reason: unknown) => { console.error(reason instanceof Error ? reason.message : '验收失败'); process.exitCode = 1; });
