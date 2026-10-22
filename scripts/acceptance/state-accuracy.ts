import { loadEnvConfig } from '@next/env';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApiSuccess, ContentList, MasteryItem, NoteItem, PlanList, Profile, Progress, WeakPoint } from '../../src/services/api';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputPath] = process.argv.slice(2);
  if (!contentId || !outputPath) throw new Error('用法：tsx scripts/acceptance/state-accuracy.ts <本人资料ID> <结果JSON路径>');
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  try {
    const selected = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    const ownerId = selected.ownerId;
    const snapshot = async (): Promise<string> => {
      const values = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { xpTotal: true, updatedAt: true } }),
        prisma.learningContent.findMany({ where: { ownerId }, orderBy: { id: 'asc' }, select: { id: true, updatedAt: true } }),
        prisma.note.findMany({ where: { ownerId }, orderBy: { id: 'asc' }, select: { id: true, version: true, updatedAt: true } }),
        prisma.learningProgress.findMany({ where: { learnerId: ownerId }, orderBy: { id: 'asc' } }),
        prisma.mastery.findMany({ where: { learnerId: ownerId }, orderBy: { id: 'asc' } }),
        prisma.exerciseRecord.findMany({ where: { learnerId: ownerId }, orderBy: { id: 'asc' }, select: { id: true, createdAt: true } }),
      ]);
      return createHash('sha256').update(JSON.stringify(values)).digest('hex');
    };
    const before = await snapshot();
    const token = signAccessToken({ sub: ownerId, email: selected.owner.email, role: selected.owner.role });
    const read = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`http://localhost:3000${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) throw new Error(`只读验收 HTTP ${response.status}`);
      return ((await response.json()) as ApiSuccess<T>).data;
    };
    const items: ContentList['items'] = [];
    for (let page = 1; ; page += 1) {
      const result = await read<ContentList>(`/api/contents?pageSize=50&page=${page}`); items.push(...result.items);
      if (page * result.pageSize >= result.total) break;
      if (!result.items.length) throw new Error('资料列表未推进');
    }
    const [profile, mastery, weak, plans, due, notes, positions] = await Promise.all([
      read<Profile>('/api/gamification/profile'), read<{ items: MasteryItem[] }>('/api/mastery'), read<{ items: WeakPoint[] }>('/api/mastery/weak-points'),
      read<PlanList>('/api/study-plans?page=1&pageSize=10'), read<{ total: number }>('/api/flashcards?due=true&pageSize=1'),
      Promise.all(items.map((item): Promise<{ items: NoteItem[] }> => read(`/api/contents/${item.contentId}/notes`))),
      Promise.all(items.filter((item) => item.status === '已就绪').map((item): Promise<Progress> => read(`/api/contents/${item.contentId}/progress`))),
    ]);
    const anonymous = await fetch('http://localhost:3000/api/gamification/profile', { signal: AbortSignal.timeout(15000) });
    if (anonymous.status !== 401) throw new Error('匿名读取未拒绝');
    const unchanged = before === await snapshot();
    if (!unchanged) throw new Error('验收期间记录改变，不能证明数据保持不变');
    const report = {
      verifiedAt: new Date().toISOString(), mode: 'read-only', contentCount: items.length, personalNotes: notes.reduce((total, value) => total + value.items.length, 0),
      xpTotal: profile.xpTotal, masteryRecords: mastery.items.length, masteryPercent: mastery.items.length === 0 ? null : Math.round(mastery.items.reduce((total, item) => total + item.score, 0) / mastery.items.length * 100),
      weakPoints: weak.items.length, plans: plans.summary, dueFlashcards: due.total, positions: positions.map((item) => item.contentType === 'video' ? { type: 'video', positionSec: item.positionSec, hasHistory: item.lastStudiedAt !== null } : { type: 'document', page: item.page, hasHistory: item.lastStudiedAt !== null }),
      recordsUnchanged: unchanged, anonymousStatus: anonymous.status, modelCalled: false, dataWritten: false, browserAuthenticatedVerified: false,
    };
    await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
