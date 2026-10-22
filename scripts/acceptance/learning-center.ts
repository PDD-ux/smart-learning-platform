import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApiSuccess, ContentList, Progress } from '../../src/services/api';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputPath] = process.argv.slice(2);
  if (!contentId || !outputPath) throw new Error('用法：tsx scripts/acceptance/learning-center.ts <本人资料ID> <结果JSON路径>');
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  try {
    const selected = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    const token = signAccessToken({ sub: selected.ownerId, email: selected.owner.email, role: selected.owner.role });
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
    const metadata = await Promise.all(items.map(async (item) => {
      const progress = item.status === '已就绪' ? await read<Progress>(`/api/contents/${item.contentId}/progress`) : null;
      if (progress && progress.contentType !== item.contentType) throw new Error('资料进度类型不匹配');
      return { contentId: item.contentId, type: item.contentType, status: item.status, aiStatus: item.understandingStatus, durationSec: item.durationSec, pageCount: item.pageCount, progress };
    }));
    const anonymous = await fetch(`http://localhost:3000/api/contents/${encodeURIComponent(contentId)}/progress`, { signal: AbortSignal.timeout(15000) });
    if (anonymous.status !== 401) throw new Error('匿名读取进度未拒绝');
    const report = { verifiedAt: new Date().toISOString(), mode: 'read-only', contentCount: items.length, items: metadata, anonymousProgressStatus: anonymous.status, modelCalled: false, dataWritten: false, browserAuthenticatedVerified: false };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
