import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { exerciseSource } from '../../src/lib/domain/exercise-source';
import { studyCitationUrl } from '../../src/lib/domain/study-location';
import type { ApiSuccess, BankList, ContentSummary, Understanding } from '../../src/services/api';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputPath] = process.argv.slice(2);
  if (!contentId || !outputPath) throw new Error('用法：tsx scripts/acceptance/exercise-sources.ts <contentId> <outputPath>');
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    const token = signAccessToken({ sub: content.ownerId, email: content.owner.email, role: content.owner.role });
    const read = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`http://localhost:3000${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) throw new Error(`接口读取失败 HTTP ${response.status}`);
      return ((await response.json()) as ApiSuccess<T>).data;
    };
    const [detail, understanding, bank] = await Promise.all([
      read<ContentSummary>(`/api/contents/${contentId}`),
      read<Understanding>(`/api/contents/${contentId}/understanding`),
      read<BankList>(`/api/exercises?contentId=${contentId}&pageSize=50`),
    ]);
    if (!bank.items.length) throw new Error('该资料暂无题目');
    const counts = bank.items.map((question): number => {
      const source = exerciseSource(detail, understanding, question.pointId);
      if (!source || !source.summary || !source.refs.length) throw new Error('题目缺少可核对的知识点来源');
      for (const ref of source.refs) {
        const url = studyCitationUrl(contentId, ref);
        if (!url.startsWith(`/study/${encodeURIComponent(contentId)}?`)) throw new Error('来源链接错误');
      }
      if ('correctAnswer' in question || 'explanation' in question) throw new Error('未作答答案泄露');
      return source.refs.length;
    });
    const response = await fetch(`http://localhost:3000/api/contents/${contentId}/understanding`, { signal: AbortSignal.timeout(15000) });
    if (response.status !== 401) throw new Error('匿名来源读取未拒绝');
    const report = { verifiedAt: new Date().toISOString(), mode: 'read-only', contentType: detail.contentType, bankTotal: bank.total, checkedQuestions: bank.items.length, verifiedSourceCounts: counts, anonymousStatus: response.status, dataWritten: false, modelCalled: false, browserGradingVerified: false };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
