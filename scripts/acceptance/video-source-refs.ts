import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

/** Reuses saved real ASR only. Never reruns or replaces an original content's products. */
async function main(): Promise<void> {
  const sourceId = process.argv[2];
  if (!sourceId) throw new Error('Usage: npx tsx scripts/acceptance/video-source-refs.ts <source-content-id>');
  const { prisma } = await import('../../src/lib/prisma');
  const { deepExtractStage } = await import('../../src/lib/jobs/pipeline/deep-extract.stage');
  const { buildStructuredContext } = await import('../../src/lib/jobs/pipeline/context-builder');
  const { contentRefSchema, isRefInRange } = await import('../../src/lib/domain/content-ref');
  const { hashPassword } = await import('../../src/lib/auth/password');
  const ownerId = `source-ref-acceptance-${randomUUID()}`;
  const traceId = randomUUID();
  const outputPath = `.taskbook-working/video-source-refs-${traceId}.json`;
  let created = false;
  const report: Record<string, unknown> = { recordedAt: new Date().toISOString(), sourceId, traceId, mode: 'real AI with retained real ASR; no new ASR/Ascend calls' };
  async function fingerprint(): Promise<string> {
    const original = await prisma.learningContent.findUnique({ where: { id: sourceId }, include: { transcripts: true, textBlocks: true, knowledgePoints: true, notes: true } });
    return createHash('sha256').update(JSON.stringify(original, (_key: string, value: unknown): unknown => typeof value === 'bigint' ? value.toString() : value)).digest('hex');
  }
  try {
    const source = await prisma.learningContent.findUnique({ where: { id: sourceId }, include: { transcripts: { orderBy: { seq: 'asc' } } } });
    if (!source || source.contentType !== 'VIDEO' || source.transcripts.length === 0 || !source.durationSec) throw new Error('Source must be a video with saved transcript and duration');
    const before = await fingerprint();
    await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.com`, nickname: '时间引用隔离验收', passwordHash: await hashPassword(randomUUID() + randomUUID()) } });
    created = true;
    const clone = await prisma.learningContent.create({ data: { ownerId, contentType: 'VIDEO', title: '真实转写引用隔离验收', fileName: 'no-media.mp4', format: 'MP4', fileSizeBytes: BigInt(0), storageKey: 'acceptance-no-media', durationSec: source.durationSec, status: 'READY', understandingStatus: 'RUNNING' } });
    await prisma.transcriptSegment.createMany({ data: source.transcripts.map((segment) => ({ contentId: clone.id, seq: segment.seq, startMs: segment.startMs, endMs: segment.endMs, text: segment.text })) });
    const context = await buildStructuredContext(clone.id);
    await deepExtractStage({ contentId: clone.id, traceId, degraded: { infer: false, asr: false } });
    const points = await prisma.knowledgePoint.findMany({ where: { contentId: clone.id }, select: { title: true, summary: true, refs: true }, orderBy: { createdAt: 'asc' } });
    const refs = points.flatMap((point) => Array.isArray(point.refs) ? point.refs : []);
    const allGrounded = refs.every((raw) => {
      const ref = contentRefSchema.safeParse(raw);
      return ref.success && ref.data.type === 'video' && isRefInRange(ref.data, source) && context.sourceRefs.some((candidate) => candidate.type === 'video' && ref.data.type === 'video' && candidate.timestampSec === ref.data.timestampSec);
    });
    const unchanged = before === await fingerprint();
    Object.assign(report, { transcriptCount: source.transcripts.length, durationSec: source.durationSec, contextTruncated: context.truncated, sourceRefs: context.sourceRefs, points, pointCount: points.length, refCount: refs.length, allGrounded, originalUnchanged: unchanged, sourceFingerprint: before, passed: points.length > 0 && refs.length > 0 && allGrounded && unchanged });
    if (!report.passed) process.exitCode = 1;
  } catch (error: unknown) {
    report.passed = false;
    report.failureKind = error instanceof Error ? error.name : 'UNKNOWN';
    process.exitCode = 1;
  } finally {
    if (created) await prisma.user.delete({ where: { id: ownerId } });
    report.cleaned = (await prisma.user.count({ where: { id: ownerId } })) === 0;
    await mkdir('.taskbook-working', { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ outputPath, passed: report.passed, pointCount: report.pointCount, refCount: report.refCount, originalUnchanged: report.originalUnchanged, cleaned: report.cleaned }));
    await prisma.$disconnect();
  }
}

void main().catch(() => { console.error('Acceptance setup/cleanup failed; inspect isolated acceptance records locally.'); process.exitCode = 1; });
