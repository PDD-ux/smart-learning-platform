// 复现视频精选调用：直接对指定窗口发起真实模型请求，观察模型输出（排障用临时脚本）
// 用法：npx tsx scripts/demo/_repro2.ts <内容ID> <窗口序号0/1/2>
import { readFileSync } from 'node:fs';

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
loadEnvOverride('.env');
loadEnvOverride('.env.local');

import { PrismaClient } from '@prisma/client';
import { bootstrapWorkers } from '../../src/lib/jobs/workers';
import { buildStructuredContext, knowledgeVideoWindows } from '../../src/lib/jobs/pipeline/context-builder';
import { VIDEO_SELECTION_PROMPT, videoSelectionSchema } from '../../src/lib/jobs/pipeline/video-quality';
import { isRefInRange, type ContentRef } from '../../src/lib/domain/content-ref';

/** 与 deep-extract.stage.ts 中 validSourceRefs 完全一致的过滤（用于复现） */
function validSourceRefs(refs: ContentRef[], sources: ContentRef[], content: { contentType: string; durationSec: number | null; pageCount: number | null }): ContentRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if ((ref.type === 'video' ? 'VIDEO' : 'DOCUMENT') !== content.contentType || !isRefInRange(ref, content)) return false;
    const matches = sources.some((source) => ref.type === 'video'
      ? source.type === 'video' && source.timestampSec === ref.timestampSec
      : source.type === 'document' && source.page === ref.page && (ref.blockIndex === undefined || source.blockIndex === ref.blockIndex));
    const key = JSON.stringify(ref);
    if (!matches || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
import { extractJson } from '../../src/lib/ai/spark';

bootstrapWorkers();
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [contentId, winArg] = process.argv.slice(2);
  const winIndex = Number(winArg ?? 0);
  const content = await prisma.learningContent.findUnique({
    where: { id: contentId },
    select: { id: true, title: true, contentType: true, durationSec: true, pageCount: true, ownerId: true },
  });
  if (!content) { console.log('未找到内容'); return; }

  const windows = knowledgeVideoWindows(content.durationSec ?? 900);
  const win = windows[winIndex];
  console.log(`窗口${winIndex}: ${win.startSec}-${win.endSec}s（共${windows.length}窗）`);

  const context = await buildStructuredContext(content.id, 6_000, win);
  const sources = (context.sourceSegments ?? [])
    .filter((source) => validSourceRefs([source.ref as ContentRef], context.sourceRefs ?? [], content).length > 0)
    .map((source, index) => ({ id: `S${index + 1}`, ...source }));
  console.log('过滤后来源数:', sources.length, '/ 原始', (context.sourceSegments ?? []).length);
  console.log(`来源数: ${sources.length}，上下文文本长度: ${context.text.length}`);

  const { data, attempts } = await extractJson(
    [
      { role: 'system', content: VIDEO_SELECTION_PROMPT },
      { role: 'user', content: JSON.stringify(sources) },
    ],
    videoSelectionSchema(sources as never),
    { timeoutMs: 60_000, traceId: 'repro', temperature: 0.1, maxTokens: 500 },
  );
  console.log('模型输出点数:', data.points.length);
  for (const p of data.points) console.log('  -', JSON.stringify(p).slice(0, 160));
  console.log('模型尝试次数:', attempts);
  await prisma.$disconnect();
}

void main();
