import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { Prisma, type PrismaClient } from '@prisma/client';
import { reviewedRefs, repairPlanSchema } from './video-refs-plan';

loadEnvConfig(process.cwd());
const include = {
  transcripts: true, textBlocks: true, notes: true, generatedNote: true, progress: true, asyncJobs: true, studyPlans: true,
  knowledgePoints: { include: { masteries: true, graphNode: true } },
  flashcards: { include: { reviewLogs: true } }, exercises: { include: { records: true } }, graphEdges: true,
} satisfies Prisma.LearningContentInclude;
type Snapshot = Prisma.LearningContentGetPayload<{ include: typeof include }>;

function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function digest(rows: Snapshot[], excludeRefs: boolean, allowedPointIds: string[] = []): string {
  const data = rows.map(row => ({ ...row, knowledgePoints: row.knowledgePoints.map(point => {
    if (!excludeRefs || !allowedPointIds.includes(point.id)) return point;
    const { refs: _refs, ...rest } = point; return rest;
  }) }));
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
}
async function snapshot(db: PrismaClient | Prisma.TransactionClient, ids: string[]): Promise<Snapshot[]> {
  return db.learningContent.findMany({ where: { id: { in: ids } }, include });
}

async function main(): Promise<void> {
  const [mode, path] = process.argv.slice(2);
  if (!path || !['check', 'apply'].includes(mode)) throw new Error('Usage: check|apply <reviewed-plan.json>');
  const plan = repairPlanSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  if (new Set(plan.points.map(point => point.pointId)).size !== plan.points.length) throw new Error('DUPLICATE_POINT');
  const { prisma } = await import('../../src/lib/prisma');
  const ids = [...new Set(plan.points.map(point => point.contentId))];
  try {
    const before = await snapshot(prisma, ids);
    const changes = plan.points.map(point => {
      const content = before.find(row => row.id === point.contentId);
      const old = content?.knowledgePoints.find(row => row.id === point.pointId);
      if (!content || !old || old.ownerId !== content.ownerId || content.contentType !== 'VIDEO' || content.status !== 'READY' || content.understandingStatus === 'RUNNING') throw new Error('CONTENT_NOT_STABLE');
      const refs = reviewedRefs(point, { ...old, durationSec: content.durationSec, transcripts: content.transcripts });
      return { pointId: point.pointId, contentId: point.contentId, ownerId: old.ownerId, oldRefs: old.refs, refs, changed: JSON.stringify(old.refs) !== JSON.stringify(refs) };
    });
    const beforeHash = digest(before, false);
    const allowedPointIds = changes.map(row => row.pointId);
    const preservedHash = digest(before, true, allowedPointIds);
    let after = before;
    const runId = randomUUID();
    await mkdir('.taskbook-working/video-refs-backfill', { recursive: true });
    const backupPath = `.taskbook-working/video-refs-backfill/${runId}-before.json`;
    await writeFile(backupPath, JSON.stringify(canonical(before), null, 2), { encoding: 'utf8', flag: 'wx' });
    if (mode === 'apply') {
      after = await prisma.$transaction(async tx => {
        if (digest(await snapshot(tx, ids), false) !== beforeHash) throw new Error('CONCURRENT_CHANGE');
        for (const change of changes.filter(row => row.changed)) {
          const result = await tx.knowledgePoint.updateMany({ where: { id: change.pointId, contentId: change.contentId, ownerId: change.ownerId, refs: { equals: change.oldRefs as Prisma.InputJsonValue } }, data: { refs: change.refs as Prisma.InputJsonValue } });
          if (result.count !== 1) throw new Error('CONCURRENT_POINT_CHANGE');
        }
        const current = await snapshot(tx, ids);
        if (digest(current, true, allowedPointIds) !== preservedHash) throw new Error('PRESERVATION_FAILED');
        return current;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    }
    const report = { recordedAt: new Date().toISOString(), task: '6.4', mode, backupPath, changedPoints: changes.filter(row => row.changed).length, preservedBefore: preservedHash, preservedAfter: digest(after, true, allowedPointIds), onlyRefsChanged: preservedHash === digest(after, true, allowedPointIds), changes: changes.map(({ ownerId: _ownerId, ...row }) => row), evidence: plan.points };
    const reportPath = `.taskbook-working/video-refs-backfill/${runId}-${mode}.json`;
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ reportPath, changedPoints: report.changedPoints, onlyRefsChanged: report.onlyRefsChanged, mode }));
  } finally { await prisma.$disconnect(); }
}
void main().catch(() => { console.error('Backfill aborted; no unverified refs accepted. Inspect source data/plan locally.'); process.exitCode = 1; });
