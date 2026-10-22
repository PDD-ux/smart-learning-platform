/** Real model verification on an isolated copy of existing parsed evidence; no ASR/vision replay. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const { prisma } = await import('../../src/lib/prisma');
  const { deepExtractStage } = await import('../../src/lib/jobs/pipeline/deep-extract.stage');
  const { productGenStage } = await import('../../src/lib/jobs/pipeline/product-gen.stage');
  const { knowledgeVideoWindows } = await import('../../src/lib/jobs/pipeline/context-builder');
  const { contentRefSchema } = await import('../../src/lib/domain/content-ref');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  const checkPlayback = process.argv[4] === '--playback';
  const sourceId = process.argv[2];
  if (!sourceId) throw new Error('Supply an existing completed video content ID');
  const output = path.resolve(process.argv[3] ?? '.taskbook-working/long-video-46m/semantic-new.json');
  await mkdir(path.dirname(output), { recursive: true });
  const result: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString(), sourceId,
    scope: 'Real model stages on an isolated copy of existing evidence; no full upload/ASR/vision/playback claim' };
  const oldIds = (await prisma.learningContent.findMany({ select: { id: true } })).map((row): string => row.id);
  const fingerprint = async (): Promise<string> => {
    const rows = await prisma.learningContent.findMany({ where: { id: { in: oldIds } }, orderBy: { id: 'asc' },
      include: { transcripts: { orderBy: { seq: 'asc' } }, textBlocks: { orderBy: { id: 'asc' } },
        knowledgePoints: { orderBy: { id: 'asc' }, include: { graphNode: true, masteries: { orderBy: { id: 'asc' } } } },
        notes: { orderBy: { id: 'asc' } }, flashcards: { orderBy: { id: 'asc' }, include: { reviewLogs: { orderBy: { id: 'asc' } } } },
        exercises: { orderBy: { id: 'asc' } }, progress: { orderBy: { id: 'asc' } },
        graphEdges: { orderBy: { id: 'asc' } }, generatedNote: true, asyncJobs: { orderBy: { id: 'asc' } } } });
    return createHash('sha256').update(JSON.stringify(rows, (_key, value: unknown): unknown =>
      typeof value === 'bigint' ? value.toString() : value)).digest('hex');
  };
  const before = await fingerprint();
  let accountId: string | undefined;
  let fixtureId: string | undefined;
  try {
    const source = await prisma.learningContent.findUniqueOrThrow({ where: { id: sourceId },
      include: { transcripts: { orderBy: { seq: 'asc' } }, textBlocks: { orderBy: { sequence: 'asc' } } } });
    if (source.contentType !== 'VIDEO' || source.understandingStatus !== 'COMPLETED'
      || (source.durationSec ?? 0) <= 300 || source.transcripts.length === 0) throw new Error('Completed parsed long video required');
    const duration = source.durationSec ?? 0;
    result.durationSec = duration;
    result.inputCounts = { transcripts: source.transcripts.length, textBlocks: source.textBlocks.length };
    accountId = (await prisma.user.create({ data: { email: `ascend-video-check-${randomUUID()}@example.invalid`,
      nickname: '窗口语义验收临时账号', passwordHash: await bcrypt.hash(randomBytes(24).toString('base64url'), 10) } })).id;
    fixtureId = (await prisma.learningContent.create({ data: { ownerId: accountId, contentType: 'VIDEO',
      title: '隔离窗口语义验收', fileName: checkPlayback ? source.fileName : 'evidence-only.mkv', format: checkPlayback ? source.format : 'MKV', durationSec: duration,
      fileSizeBytes: checkPlayback ? source.fileSizeBytes : 0n,
      storageKey: checkPlayback ? source.storageKey : `acceptance-evidence-only/${randomUUID()}`, status: 'READY' } })).id;
    result.originalMediaReadOnly = checkPlayback;
    result.fixtureId = fixtureId;
    await prisma.transcriptSegment.createMany({ data: source.transcripts.map((row): Prisma.TranscriptSegmentCreateManyInput =>
      ({ contentId: fixtureId as string, seq: row.seq, startMs: row.startMs, endMs: row.endMs, text: row.text })) });
    await prisma.textBlock.createMany({ data: source.textBlocks.map((row): Prisma.TextBlockCreateManyInput =>
      ({ contentId: fixtureId as string, source: row.source, sequence: row.sequence, text: row.text, ref: row.ref as Prisma.InputJsonValue })) });
    const ctx = { contentId: fixtureId, traceId: randomUUID(), degraded: { infer: false, asr: false } };
    result.stage = 'deep-extract';
    await deepExtractStage(ctx);
    const points = await prisma.knowledgePoint.findMany({ where: { contentId: fixtureId }, select: { id: true, refs: true } });
    const sources = new Set(source.transcripts.map((row): number => Math.floor(row.startMs / 1000)));
    for (const block of source.textBlocks) {
      const ref = contentRefSchema.safeParse(block.ref);
      if (ref.success && ref.data.type === 'video') sources.add(ref.data.timestampSec);
    }
    const refs = points.flatMap((point): unknown[] => Array.isArray(point.refs) ? point.refs : []);
    result.pointRefCounts = points.map((point): number => Array.isArray(point.refs) ? point.refs.length : 0);
    result.refs = refs;
    result.allPointsLocated = points.length > 0 && points.every((point): boolean => Array.isArray(point.refs) && point.refs.length > 0);
    result.allRefsMatchEvidence = refs.every((value): boolean => {
      const ref = contentRefSchema.safeParse(value);
      return ref.success && ref.data.type === 'video' && sources.has(ref.data.timestampSec)
        && ref.data.timestampSec >= 0 && ref.data.timestampSec <= duration;
    });
    const windows = knowledgeVideoWindows(duration).map((window): { startSec: number; endSec: number; located: boolean } =>
      ({ ...window, located: refs.some((value): boolean => { const ref = contentRefSchema.safeParse(value);
        return ref.success && ref.data.type === 'video' && ref.data.timestampSec >= window.startSec && ref.data.timestampSec < window.endSec; }) }));
    result.windows = windows;
    result.allWindowsLocated = windows.every((window): boolean => window.located);
    result.stage = 'product-gen';
    await productGenStage(ctx);
    const cards = await prisma.flashcard.findMany({ where: { contentId: fixtureId }, select: { pointId: true } });
    const pointIds = new Set(points.map((point): string => point.id));
    result.allCardsLinked = cards.length > 0 && cards.every((card): boolean => card.pointId !== null && pointIds.has(card.pointId));
    const note = await prisma.generatedNote.findUnique({ where: { contentId: fixtureId } });
    result.artifactCounts = { knowledgePoints: points.length, flashcards: cards.length, generatedNotes: note ? 1 : 0 };
    result.generatedNoteSourceCount = note?.sourceCount ?? 0;
    if (!result.allPointsLocated || !result.allRefsMatchEvidence || !result.allWindowsLocated || !result.allCardsLinked
      || !note?.markdown.trim()) throw new Error('Windowed semantic artifacts did not meet citation and coverage checks');
    if (checkPlayback) {
      const token = signAccessToken({ sub: accountId, email: null, role: 'student' });
      const api = async (route: string, method = 'GET', body?: unknown): Promise<unknown> => {
        const response = await fetch(`http://127.0.0.1:3000/api/contents/${fixtureId}/${route}`, { method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
        const envelope = z.object({ success: z.boolean(), data: z.unknown().optional() }).parse(await response.json());
        if (!response.ok || !envelope.success) throw new Error('Isolated demo API verification failed');
        return envelope.data;
      };
      const anchorSec = Math.max(0, duration - 60);
      result.anchorSec = anchorSec;
      await api('notes', 'POST', { content: '临时演练定位笔记', ref: { type: 'video', timestampSec: anchorSec } });
      const notes = z.object({ items: z.array(z.object({ ref: contentRefSchema })) }).parse(await api('notes'));
      result.manualNoteAnchorValid = notes.items.some((row): boolean => row.ref.type === 'video' && row.ref.timestampSec === anchorSec);
      await api('progress', 'PUT', { contentType: 'video', positionSec: anchorSec });
      result.progressRoundTripValid = z.object({ positionSec: z.number() }).parse(await api('progress')).positionSec === anchorSec;
      const resource = z.object({ url: z.string() }).parse(await api('resource'));
      const response = await fetch(new URL(resource.url, 'http://127.0.0.1:3000'), { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(30000) });
      result.playbackRangeStatus = response.status;
      result.playbackRangeBytes = (await response.arrayBuffer()).byteLength;
      result.generatedNoteApiReached = typeof await api('generated-note') === 'object';
      if (!result.manualNoteAnchorValid || !result.progressRoundTripValid || response.status !== 206
        || result.playbackRangeBytes !== 1024 || !result.generatedNoteApiReached) throw new Error('Isolated demo time anchor or media check failed');
    }
    result.status = 'passed';
    result.stage = 'completed';
  } catch (error: unknown) {
    result.status = 'failed';
    result.errorCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code : 'VERIFICATION_FAILED';
    result.errorCategory = error instanceof Error && error.message.includes('JSON 解析失败') ? 'JSON_PARSE'
      : result.errorCode === 'SCHEMA_INVALID' ? 'SCHEMA_VALIDATION' : 'OTHER';
    process.exitCode = 1;
  } finally {
    if (accountId) await prisma.user.delete({ where: { id: accountId } });
    result.fixtureCleaned = !fixtureId || await prisma.learningContent.count({ where: { id: fixtureId } }) === 0;
    result.existingContentCount = oldIds.length;
    result.existingArtifactsUnchanged = before === await fingerprint();
    if (!result.fixtureCleaned || !result.existingArtifactsUnchanged) { result.status = 'failed'; process.exitCode = 1; }
    result.finishedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    await prisma.$disconnect();
    console.log(JSON.stringify({ status: result.status, artifactCounts: result.artifactCounts, fixtureCleaned: result.fixtureCleaned,
      existingArtifactsUnchanged: result.existingArtifactsUnchanged, output }));
  }
}

void main().catch((): void => { console.error('Isolated semantic verification setup or cleanup failed'); process.exitCode = 1; });
