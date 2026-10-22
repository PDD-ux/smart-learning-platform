import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApiSuccess, ContentList, BankList, Progress } from '../../src/services/api';
import type { DailyCheckIn } from '../../src/services/attendance';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputPath] = process.argv.slice(2);
  if (!contentId || !outputPath) throw new Error('用法：tsx scripts/acceptance/dashboard-tasks.ts <本人资料ID> <结果JSON路径>');
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    const token = signAccessToken({ sub: content.ownerId, email: content.owner.email, role: content.owner.role });
    const read = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`http://localhost:3000${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) throw new Error(`只读验收 HTTP ${response.status}`);
      return ((await response.json()) as ApiSuccess<T>).data;
    };
    const items: ContentList['items'] = [];
    for (let page = 1; ; page += 1) {
      const result = await read<ContentList>(`/api/contents?pageSize=50&page=${page}`);
      items.push(...result.items);
      if (page * result.pageSize >= result.total) break;
      if (!result.items.length) throw new Error('资料列表未推进');
    }
    const [due, wrong, daily, positions] = await Promise.all([
      read<{ total: number }>('/api/flashcards?due=true&pageSize=1'),
      read<BankList>('/api/exercises?status=wrong&page=1'),
      read<DailyCheckIn>('/api/attendance/today'),
      Promise.all(items.filter((item) => item.status === '已就绪').map(async (item): Promise<Progress> => read<Progress>(`/api/contents/${item.contentId}/progress`))),
    ]);
    const anonymous = await fetch('http://localhost:3000/api/exercises?status=wrong', { signal: AbortSignal.timeout(15000) });
    if (anonymous.status !== 401) throw new Error('匿名读取未拒绝');
    const report = { verifiedAt: new Date().toISOString(), mode: 'read-only', contentCount: items.length, readyCount: positions.length, dueFlashcards: due.total, historicallyWrongQuestions: wrong.total, checkedIn: daily.checkedIn, method: daily.method, positions: positions.map((item) => item.contentType === 'video' ? { type: 'video', positionSec: item.positionSec, hasHistory: item.lastStudiedAt !== null } : { type: 'document', page: item.page, hasHistory: item.lastStudiedAt !== null }), anonymousStatus: anonymous.status, modelCalled: false, dataWritten: false, browserAuthenticatedVerified: false };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
