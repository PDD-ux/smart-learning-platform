import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApiSuccess, ContentSummary, GeneratedNote, NoteItem, Progress, Resource, Understanding } from '../../src/services/api';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputPath] = process.argv.slice(2);
  if (!contentId || !outputPath) throw new Error('用法：tsx scripts/acceptance/study-focus.ts <本人资料ID> <结果JSON路径>');
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
    const prefix = `/api/contents/${encodeURIComponent(contentId)}`;
    const [content, resource, understanding, progress, status, generated, notes] = await Promise.all([
      read<ContentSummary>(prefix), read<Resource>(`${prefix}/resource`), read<Understanding>(`${prefix}/understanding`), read<Progress>(`${prefix}/progress`),
      read<{ phase: string }>(`${prefix}/understanding/status`), read<{ note: GeneratedNote | null }>(`${prefix}/generated-note`), read<{ items: NoteItem[] }>(`${prefix}/notes`),
    ]);
    if (content.status !== '已就绪' || resource.contentType !== content.contentType || progress.contentType !== content.contentType) throw new Error('学习资料类型或状态不符');
    const refs = understanding.knowledgePoints.flatMap((point) => point.refs);
    const validRefs = refs.every((ref): boolean => ref.type === content.contentType && (ref.type === 'video' ? Number.isFinite(ref.timestampSec) && ref.timestampSec >= 0 && (content.durationSec === null || ref.timestampSec <= content.durationSec) : Number.isSafeInteger(ref.page) && ref.page >= 1 && (content.pageCount === null || ref.page <= content.pageCount)));
    if (!validRefs) throw new Error('引用范围不符');
    const anonymous = await fetch(`http://localhost:3000${prefix}/understanding`, { signal: AbortSignal.timeout(15000) });
    if (anonymous.status !== 401) throw new Error('匿名读取未拒绝');
    const report = { verifiedAt: new Date().toISOString(), mode: 'read-only', contentStatus: content.status, format: resource.format, durationSec: content.durationSec, phase: status.phase, progress, knowledgePoints: understanding.knowledgePoints.length, validReferences: refs.length, transcriptSegments: understanding.transcriptSegments.length, textBlocks: understanding.textBlocks.length, generatedNotePresent: generated.note !== null, personalNotes: notes.items.length, anonymousStatus: anonymous.status, modelCalled: false, dataWritten: false, browserAuthenticatedVerified: false };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
