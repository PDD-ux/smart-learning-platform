// 触发指定内容的 AI 理解重试并跟踪任务状态（排障用临时脚本）
// 用法：npx tsx scripts/demo/understanding-retry.ts <标题关键词> retry|watch
import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

// 手动解析 .env.local（Next 优先用它），保证 mint 出的 token 能通过鉴权
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
    // 引号包裹的值：取到闭合引号为止（允许后面跟行内注释）
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      // 无引号：去掉行内注释
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    process.env[key] = value;
  }
}
loadEnvOverride('.env');
loadEnvOverride('.env.local');

import { issueSession, toPublicUser, passwordVersion } from '../../src/lib/auth/session';

const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:3000';

async function main(): Promise<void> {
  const [keyword, action] = process.argv.slice(2);
  const content = await prisma.learningContent.findFirst({
    where: { title: { contains: keyword ?? '' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, ownerId: true, understandingStatus: true },
  });
  if (!content) {
    console.log('找不到内容');
    return;
  }
  console.log(`内容: ${content.title} (${content.id}) 理解状态=${content.understandingStatus}`);

  const owner = await prisma.user.findUnique({ where: { id: content.ownerId } });
  if (!owner) {
    console.log('找不到所有者');
    return;
  }
  const token = issueSession(toPublicUser(owner), passwordVersion(owner.passwordHash), true).accessToken;

  if (action === 'retry') {
    const res = await fetch(`${BASE}/api/contents/${content.id}/understanding/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    console.log('重试请求:', res.status, (await res.text()).slice(0, 150));
  }

  const job = await prisma.asyncJob.findFirst({
    where: { contentId: content.id, jobType: 'UNDERSTANDING' },
    orderBy: { updatedAt: 'desc' },
    select: { state: true, attempts: true, stage: true, errorReason: true, updatedAt: true },
  });
  const blocks = await prisma.textBlock.count({ where: { contentId: content.id } });
  console.log(`任务: state=${job?.state} attempts=${job?.attempts} stage=${job?.stage ?? '-'} 画面文字块=${blocks}`);
  if (job?.errorReason) console.log(`  err: ${job.errorReason.slice(0, 220)}`);
  await prisma.$disconnect();
}

void main();
