/** Real HTTP upload pipeline; owns only a temporary verification account. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const base = 'http://127.0.0.1:3000';
const output = process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/demo/accept-local-product.ts OUTPUT.json');
const result: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString() };
let token = '';
let accountId: string | undefined;
let contentId: string | undefined;
let terminal = false;

async function api(route: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000),
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
  return createHash('sha256').update(JSON.stringify(records, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value)).digest('hex');
}

async function main(): Promise<void> {
  const oldIds = (await prisma.learningContent.findMany({ select: { id: true } })).map((row) => row.id);
  const before = await fingerprint(oldIds);
  try {
    const account = `ascend-check-${randomUUID()}@example.invalid`;
    const password = randomBytes(24).toString('base64url');
    accountId = (await prisma.user.create({ data: { email: account, nickname: 'Ascend 临时验收',
      passwordHash: await bcrypt.hash(password, 10) } })).id;
    token = z.object({ accessToken: z.string() }).parse(await api('/api/auth/login', 'POST', { account, password })).accessToken;
    const bytes = await readFile(path.resolve('.taskbook-working/video-infer-diagnostic-20261003/frame_014.jpg'));
    result.sampleSha256 = createHash('sha256').update(bytes).digest('hex');
    const intent = z.object({ contentId: z.string(), uploadUrl: z.string() }).parse(await api(
      '/api/contents/upload-intent', 'POST', { contentType: 'document', fileName: 'ascend-product-check.jpg',
        fileSize: bytes.length, mimeType: 'image/jpeg' }));
    contentId = intent.contentId;
    result.contentId = contentId;
    const uploaded = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' },
      body: bytes, signal: AbortSignal.timeout(60_000) });
    if (!uploaded.ok) throw new Error(`Upload HTTP ${uploaded.status}`);
    await api(`/api/contents/${contentId}/complete`, 'POST', { size: bytes.length });
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId } });
      const jobs = await prisma.asyncJob.findMany({ where: { contentId }, select: { state: true } });
      if (['COMPLETED', 'FAILED'].includes(content.understandingStatus) && jobs.every((job) => ['COMPLETED', 'FAILED', 'SUCCEEDED'].includes(job.state))) {
        terminal = true;
        result.contentStatus = content.status;
        result.pageCount = content.pageCount;
        result.understandingStatus = content.understandingStatus;
        result.jobs = jobs;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }
    if (!terminal) throw new Error('Product pipeline timed out; fixture retained to avoid deleting a running job');
    const blocks = await prisma.textBlock.findMany({ where: { contentId }, orderBy: { sequence: 'asc' }, select: { source: true, text: true, ref: true } });
    result.blocks = blocks;
    result.blockCount = blocks.length;
    const baseline = z.object({ results: z.array(z.object({ frame: z.string(), blocks: z.array(z.object({ text: z.string() })) })) })
      .parse(JSON.parse(await readFile('docs/performance/mindspore-20261008-ocr-fixed.json', 'utf8')));
    const expected = baseline.results.find((row) => row.frame === 'frame_014.jpg');
    result.matchesRealAscendBaseline = expected !== undefined &&
      JSON.stringify(blocks.map((block) => block.text)) === JSON.stringify(expected.blocks.map((block) => block.text));
    const knowledgePointCount = await prisma.knowledgePoint.count({ where: { contentId } });
    const flashcardCount = await prisma.flashcard.count({ where: { contentId } });
    result.knowledgePointCount = knowledgePointCount;
    const points = await prisma.knowledgePoint.findMany({ where: { contentId }, select: { refs: true } });
    result.allKnowledgePointsLocated = points.length > 0 && points.every((point): boolean =>
      Array.isArray(point.refs) && point.refs.length > 0 && point.refs.every((ref: unknown): boolean =>
        typeof ref === 'object' && ref !== null && 'type' in ref && ref.type === 'document' && 'page' in ref && ref.page === 1));
    result.flashcardCount = flashcardCount;
    const understanding = await api(`/api/contents/${contentId}/understanding`);
    result.understandingApiReached = typeof understanding === 'object' && understanding !== null;
    if (result.understandingStatus !== 'COMPLETED' || !result.matchesRealAscendBaseline || blocks.length === 0 || blocks.some((block) => block.source !== 'OCR')
      || knowledgePointCount === 0 || flashcardCount === 0 || !result.understandingApiReached
      || result.pageCount !== 1 || !result.allKnowledgePointsLocated) {
      throw new Error('Real image pipeline did not produce completed OCR artifacts');
    }
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : 'Unknown verification error';
    process.exitCode = 1;
  } finally {
    if (accountId && (!contentId || terminal)) {
      if (contentId) await api(`/api/contents/${contentId}`, 'DELETE');
      await prisma.user.delete({ where: { id: accountId } });
      result.fixtureCleaned = true;
    } else result.fixtureCleaned = false;
    result.existingContentCount = oldIds.length;
    result.existingArtifactsUnchanged = before === await fingerprint(oldIds);
    if (!result.existingArtifactsUnchanged) { result.status = 'failed'; process.exitCode = 1; }
    result.finishedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    await prisma.$disconnect();
    console.log(JSON.stringify({ status: result.status, blockCount: result.blockCount,
      fixtureCleaned: result.fixtureCleaned, existingArtifactsUnchanged: result.existingArtifactsUnchanged, output }));
  }
}
void main().catch(() => { console.error('Verification setup or cleanup failed'); process.exitCode = 1; });
