/**
 * 独立进程直跑「理解管线」（不走 HTTP 服务与队列）：
 *   npx tsx scripts/demo/understanding-direct.ts [标题关键词]
 * 用于 dev 服务无法启动时验证新模型 + 管线修复是否真正生效。
 */
import { readFileSync } from 'node:fs';

function loadEnvOverride(file: string): void {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") { const end = value.indexOf(quote, 1); value = end > 0 ? value.slice(1, end) : value.slice(1); }
    else { const hash = value.indexOf(' #'); if (hash >= 0) value = value.slice(0, hash).trim(); }
    process.env[key] = value;
  }
}
loadEnvOverride('.env.local');

import { PrismaClient } from '@prisma/client';
import { bootstrapWorkers } from '../../src/lib/jobs/workers';
import { runUnderstandingPipeline } from '../../src/lib/jobs/pipeline/understanding-pipeline';
import type { JobContext, JobPayload } from '../../src/lib/queue';

// 注册各阶段处理器（进程级，一次即可）
bootstrapWorkers();

const prisma = new PrismaClient();
const KEYWORD = process.argv[2] ?? '映射与函数';

async function main(): Promise<void> {
  // 支持直接传内容 ID，或按标题关键词取最新一条
  const isId = /^(c|m)[a-z0-9]{20,}$/.test(KEYWORD);
  const content = await (isId
    ? prisma.learningContent.findUnique({ where: { id: KEYWORD }, select: { id: true, title: true, understandingStatus: true } })
    : prisma.learningContent.findFirst({
        where: { title: { contains: KEYWORD } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, understandingStatus: true },
      }));
  if (!content) { console.log('未找到资料'); return; }
  console.log('内容:', content.title, '| 状态:', content.understandingStatus, '| 开始直跑管线…');
  const payload: JobPayload = { contentId: content.id, traceId: `direct-${Date.now()}` };
  const ctx: JobContext = { name: 'UNDERSTANDING', attempts: 1, maxAttempts: 3, traceId: payload.traceId, contentId: content.id };
  const started = Date.now();
  try {
    await runUnderstandingPipeline(payload, ctx);
    console.log(`✔ 管线完成，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    console.log(`✖ 管线失败（${Math.round((Date.now() - started) / 1000)}s）:`, error instanceof Error ? error.message.slice(0, 300) : error);
    process.exitCode = 1;
    return;
  }
  // 产物统计
  const after = await prisma.learningContent.findUnique({ where: { id: content.id }, select: { understandingStatus: true } });
  const points = await prisma.knowledgePoint.count({ where: { contentId: content.id } });
  const flashcards = await prisma.flashcard.count({ where: { ownerId: (await prisma.learningContent.findUnique({ where: { id: content.id }, select: { ownerId: true } }))?.ownerId } });
  console.log('最终状态:', after?.understandingStatus, '| 该内容知识点:', String(points), '| 属主闪卡总数:', String(flashcards));
  await prisma.$disconnect();
}

void main();
