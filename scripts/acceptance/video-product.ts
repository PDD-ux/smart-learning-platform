/** Real video HTTP acceptance; optional sample path, isolated temporary account. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { contentRefSchema } from '../../src/lib/domain/content-ref';
import { knowledgeVideoWindows } from '../../src/lib/jobs/pipeline/context-builder';
import { probeVideo } from '../../src/lib/media/ffmpeg';

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const base = 'http://127.0.0.1:3000';
const samplePath = path.resolve(process.argv[3] ?? '.taskbook-working/long-video-46m/clip-46m.mkv');
const sampleMime = ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' } as Record<string, string>)[path.extname(samplePath).toLowerCase()] ?? 'video/x-matroska';
const output = path.resolve(process.argv[2] ?? '.taskbook-working/long-video-46m/product-acceptance-new.json');
const expectedOcrText = process.argv[4]?.trim() ?? '';
const expectedAsrText = process.argv[5]?.trim() ?? '';
const progressPath = output + '.progress.json';
const result: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString() };
let token = '';
let accountId: string | undefined;
let contentId: string | undefined;
let terminal = false;
let submitted = false;
let fixtureAccount = '';
let fixturePassword = '';
let lastLoginAt = 0;

async function api(route: string, method = 'GET', body?: unknown): Promise<unknown> {
  if (token && route !== '/api/auth/login' && Date.now() - lastLoginAt > 600_000) {
    token = z.object({ accessToken: z.string() }).parse(await api('/api/auth/login', 'POST', { account: fixtureAccount, password: fixturePassword })).accessToken;
    lastLoginAt = Date.now();
  }
  const response = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(600_000),
  });
  const envelope = z.object({ success: z.boolean(), data: z.unknown().optional() }).parse(await response.json());
  if (!response.ok || !envelope.success) throw new Error(`HTTP ${response.status} at ${route}`);
  return envelope.data;
}

async function fingerprint(ids: string[]): Promise<string> {
  const records = await prisma.learningContent.findMany({
    where: { id: { in: ids } }, orderBy: { id: 'asc' },
    include: { transcripts: { orderBy: { seq: 'asc' } }, textBlocks: { orderBy: { sequence: 'asc' } },
      notes: { orderBy: { id: 'asc' } }, flashcards: { orderBy: { id: 'asc' } }, generatedNote: true },
  });
  return createHash('sha256').update(JSON.stringify(records, (_key, value: unknown): unknown =>
    typeof value === 'bigint' ? value.toString() : value)).digest('hex');
}

async function counts(id: string): Promise<Record<string, number>> {
  const [transcripts, textBlocks, knowledgePoints, flashcards, exercises, generatedNotes] = await Promise.all([
    prisma.transcriptSegment.count({ where: { contentId: id } }),
    prisma.textBlock.count({ where: { contentId: id } }),
    prisma.knowledgePoint.count({ where: { contentId: id } }),
    prisma.flashcard.count({ where: { contentId: id } }),
    prisma.exercise.count({ where: { contentId: id } }),
    prisma.generatedNote.count({ where: { contentId: id } }),
  ]);
  return { transcripts, textBlocks, knowledgePoints, flashcards, exercises, generatedNotes };
}

async function main(): Promise<void> {
  const oldIds = (await prisma.learningContent.findMany({ select: { id: true } })).map((row): string => row.id);
  const before = await fingerprint(oldIds);
  try {
    const bytes = await readFile(samplePath);
    result.sampleSha256 = createHash('sha256').update(bytes).digest('hex');
    result.sampleBytes = bytes.length;
    const probe = await probeVideo(samplePath);
    result.sampleDurationSec = probe.durationSec;
    const account = `ascend-video-check-${randomUUID()}@example.invalid`;
    const password = randomBytes(24).toString('base64url');
    fixtureAccount = account;
    fixturePassword = password;
    lastLoginAt = Date.now();
    accountId = (await prisma.user.create({ data: {
      email: account, nickname: '视频验收临时账号', passwordHash: await bcrypt.hash(password, 10),
    } })).id;
    result.fixtureAccountId = accountId;
    token = z.object({ accessToken: z.string() }).parse(await api('/api/auth/login', 'POST', { account, password })).accessToken;
    const intent = z.object({ contentId: z.string(), uploadUrl: z.string() }).parse(await api(
      '/api/contents/upload-intent', 'POST', {
        contentType: 'video', fileName: path.basename(samplePath),
        fileSize: bytes.length, mimeType: sampleMime,
      }));
    contentId = intent.contentId;
    result.contentId = contentId;
    await writeFile(progressPath, JSON.stringify({ stage: 'uploading', contentId, at: new Date().toISOString() }, null, 2));
    const uploaded = await fetch(new URL(intent.uploadUrl, base), {
      method: 'PUT', headers: { 'Content-Type': sampleMime }, body: bytes,
      signal: AbortSignal.timeout(600_000),
    });
    if (!uploaded.ok) throw new Error(`Upload HTTP ${uploaded.status}`);
    await api(`/api/contents/${contentId}/complete`, 'POST', { size: bytes.length });
    submitted = true;
    result.uploadCompletedAt = new Date().toISOString();

    const deadline = Date.now() + 2_700_000;
    let lastProgress = '';
    while (Date.now() < deadline) {
      const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId } });
      const jobs = await prisma.asyncJob.findMany({
        where: { contentId }, orderBy: { createdAt: 'asc' },
        select: { jobType: true, state: true, stage: true, attempts: true, durationMs: true, updatedAt: true, errorReason: true },
      });
      const state = { at: new Date().toISOString(), contentId, contentStatus: content.status,
        understandingStatus: content.understandingStatus, jobs: jobs.map(({ errorReason: _error, ...job }): typeof job => job),
        counts: await counts(contentId) };
      const serialized = JSON.stringify(state);
      if (serialized !== lastProgress) {
        lastProgress = serialized;
        await writeFile(progressPath, JSON.stringify(state, null, 2));
      }
      if (['COMPLETED', 'FAILED'].includes(content.understandingStatus) &&
          jobs.length > 0 && jobs.every((job): boolean => ['SUCCEEDED', 'FAILED'].includes(job.state))) {
        terminal = true;
        const errors = jobs.filter((job): boolean => Boolean(job.errorReason)).map((job): Record<string, string | number> => ({ jobType: job.jobType, state: job.state,
          reasonLength: job.errorReason?.length ?? 0 }));
        result.contentStatus = content.status;
        result.understandingStatus = content.understandingStatus;
        result.jobs = jobs.map(({ errorReason: _error, ...job }): typeof job => job);
        result.errorEvidence = errors;
        result.artifactCounts = await counts(contentId);
        break;
      }
      await new Promise<void>((resolve): void => { setTimeout(resolve, 10_000); });
    }
    if (!terminal) throw new Error('Product video pipeline timed out; fixture retained while a job may still be running');
    const understanding = await api(`/api/contents/${contentId}/understanding`);
    result.understandingApiReached = typeof understanding === 'object' && understanding !== null;
    const artifactCounts = result.artifactCounts as Record<string, number>;
    if (result.contentStatus !== 'READY' || result.understandingStatus !== 'COMPLETED' ||
        artifactCounts.transcripts === 0 || artifactCounts.textBlocks === 0 || artifactCounts.knowledgePoints === 0 || artifactCounts.flashcards === 0) {
      throw new Error('Video product pipeline did not complete with transcript and learning artifacts');
    }
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId } });
    const durationMs = Math.round((content.durationSec ?? 0) * 1000);
    const transcripts = await prisma.transcriptSegment.findMany({ where: { contentId }, orderBy: { seq: 'asc' },
      select: { seq: true, startMs: true, endMs: true } });
    result.transcriptBoundsValid = transcripts.every((row, index): boolean => row.seq === index && row.startMs >= 0
      && row.endMs >= row.startMs && row.endMs <= durationMs
      && (index === 0 || row.startMs >= transcripts[index - 1].startMs));
    result.lastTranscriptEndMs = transcripts.at(-1)?.endMs;
    const points = await prisma.knowledgePoint.findMany({ where: { contentId }, select: { refs: true } });
    result.knowledgePointRefCounts = points.map((point): number => Array.isArray(point.refs) ? point.refs.length : 0);
    result.unlocatedKnowledgePoints = points.filter((point): boolean => !Array.isArray(point.refs) || point.refs.length === 0).length;
    const refs = points.flatMap((point): unknown[] => Array.isArray(point.refs) ? point.refs : []);
    result.knowledgeRefs = refs;
    result.refsValid = refs.length > 0 && result.unlocatedKnowledgePoints === 0 && refs.every((value): boolean => {
      const ref = contentRefSchema.safeParse(value);
      return ref.success && ref.data.type === 'video' && ref.data.timestampSec >= 0
        && ref.data.timestampSec * 1000 <= durationMs;
    });
    const windows = knowledgeVideoWindows(content.durationSec ?? 0);
    const windowCoverage = windows.map((window): { startSec: number; endSec: number; located: boolean } => ({ ...window,
      located: refs.some((value): boolean => {
        const ref = contentRefSchema.safeParse(value);
        return ref.success && ref.data.type === 'video' && ref.data.timestampSec >= window.startSec && ref.data.timestampSec < window.endSec;
      }),
    }));
    result.knowledgeWindowCoverage = windowCoverage;
    result.allKnowledgeWindowsLocated = windowCoverage.every((window): boolean => window.located);
    const note = await prisma.generatedNote.findUnique({ where: { contentId } });
    result.generatedNotePresent = Boolean(note?.markdown.trim());
    result.generatedNoteSourceCount = note?.sourceCount ?? 0;
    const noteApi = await api(`/api/contents/${contentId}/generated-note`);
    result.generatedNoteApiReached = typeof noteApi === 'object' && noteApi !== null;
    if (!result.transcriptBoundsValid || !result.refsValid || !result.allKnowledgeWindowsLocated || !result.generatedNotePresent || !result.generatedNoteApiReached) {
      throw new Error('Video time references or generated note acceptance failed');
    }
    const anchorSec = Math.max(0, Math.min(2700, Math.floor((content.durationSec ?? 0) - 60)));
    result.anchorSec = anchorSec;
    await api(`/api/contents/${contentId}/notes`, 'POST', { content: '临时验收定位笔记',
      ref: { type: 'video', timestampSec: anchorSec } });
    const notes = z.object({ items: z.array(z.object({ ref: contentRefSchema })) })
      .parse(await api(`/api/contents/${contentId}/notes`));
    result.manualNoteAnchorValid = notes.items.some((item): boolean => item.ref.type === 'video' && item.ref.timestampSec === anchorSec);
    await api(`/api/contents/${contentId}/progress`, 'PUT', { contentType: 'video', positionSec: anchorSec });
    const progress = z.object({ positionSec: z.number() }).parse(await api(`/api/contents/${contentId}/progress`));
    result.progressRoundTripValid = progress.positionSec === anchorSec;
    const resource = z.object({ url: z.string(), durationSec: z.number() })
      .parse(await api(`/api/contents/${contentId}/resource`));
    const playback = await fetch(new URL(resource.url, base), { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(30_000) });
    result.playbackRangeStatus = playback.status;
    result.playbackRangeBytes = (await playback.arrayBuffer()).byteLength;
    if (!result.manualNoteAnchorValid || !result.progressRoundTripValid || playback.status !== 206 || result.playbackRangeBytes !== 1024) {
      throw new Error('Note anchor, progress or media range acceptance failed');
    }
    if (expectedOcrText) {
      const blocks = await prisma.textBlock.findMany({ where: { contentId, source: 'FRAME' }, select: { text: true } });
      result.expectedOcrTextFound = blocks.some((block): boolean => block.text.includes(expectedOcrText));
      if (!result.expectedOcrTextFound) throw new Error('Expected text was not found in real video OCR');
    }
    if (expectedAsrText) {
      const segments = await prisma.transcriptSegment.findMany({ where: { contentId }, select: { text: true } });
      result.expectedAsrTextFound = segments.some((segment): boolean => segment.text.includes(expectedAsrText));
      if (!result.expectedAsrTextFound) throw new Error('Expected spoken word was not found in real video ASR');
    }
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : 'Unknown verification error';
    process.exitCode = 1;
  } finally {
    try {
      if (accountId && (!contentId || terminal || !submitted)) {
        if (contentId) await api(`/api/contents/${contentId}`, 'DELETE');
        await prisma.user.delete({ where: { id: accountId } });
        result.fixtureCleaned = true;
      } else result.fixtureCleaned = false;
    } catch (error: unknown) {
      // Web/controller failure must not erase the actual verification result or claim cleanup.
      result.fixtureCleaned = false;
      result.cleanupErrorType = error instanceof Error ? error.name : 'UnknownError';
      result.status = 'failed';
      process.exitCode = 1;
    }
    result.existingContentCount = oldIds.length;
    result.existingArtifactsUnchanged = before === await fingerprint(oldIds);
    if (!result.existingArtifactsUnchanged) { result.status = 'failed'; process.exitCode = 1; }
    result.finishedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    await prisma.$disconnect();
    console.log(JSON.stringify({ status: result.status, artifactCounts: result.artifactCounts,
      fixtureCleaned: result.fixtureCleaned, existingArtifactsUnchanged: result.existingArtifactsUnchanged,
      output, progressPath }));
  }
}

void main().catch((): void => { console.error('Video verification setup or cleanup failed'); process.exitCode = 1; });
