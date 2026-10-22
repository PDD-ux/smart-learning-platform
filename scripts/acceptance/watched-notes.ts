import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { WatchedNote } from '../../src/lib/domain/watched-notes';
loadEnvConfig(process.cwd(), true);

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? '');
  assert.ok(output.startsWith(path.resolve('.taskbook-working') + path.sep)); await mkdir(output, { recursive: false });
  const { prisma } = await import('../../src/lib/prisma');
  const { hashPassword } = await import('../../src/lib/auth/password');
  const ownerId = `watched-test-${randomUUID()}`;
  const email = `${ownerId}@example.test`; const password = `${randomUUID()}!Aa9`;
  let contentId = '';
  try {
    const storageCase = process.argv.includes('--storage');
    const original = await prisma.learningContent.findUniqueOrThrow({ where: { id: 'cmuqhyf7h00027q29tijy4uer' }, include: { transcripts: { where: storageCase ? { startMs: { gte: 339000 }, endMs: { lte: 352500 } } : undefined, orderBy: { startMs: 'asc' }, take: storageCase ? 3 : 1 } } });
    assert.equal(original.contentType, 'VIDEO'); assert.ok(original.transcripts.length);
    await prisma.user.create({ data: { id: ownerId, email, nickname: '随看笔记隔离验收', passwordHash: await hashPassword(password), role: 'student' } });
    const copy = await prisma.learningContent.create({ data: { ownerId, contentType: original.contentType, status: 'READY', title: '真实视频转写只读验收副本', fileName: original.fileName, format: original.format, fileSizeBytes: original.fileSizeBytes, storageKey: original.storageKey, durationSec: original.durationSec, transcripts: { create: original.transcripts.map((segment): { seq: number; startMs: number; endMs: number; text: string } => ({ seq: segment.seq, startMs: segment.startMs, endMs: segment.endMs, text: segment.text })) } }, include: { transcripts: true } });
    contentId = copy.id;
    const base = 'http://127.0.0.1:3000';
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: email, password }) });
    assert.equal(login.status, 200); const authenticated = await login.json() as { data: { accessToken: string } };
    const source = copy.transcripts[0];
    const body = { segmentIds: copy.transcripts.map((segment): string => segment.id), throughSec: Math.max(...copy.transcripts.map((segment): number => segment.endMs)) / 1000 };
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${authenticated.data.accessToken}` };
    const route = base + `/api/contents/${contentId}/ai/watched-note`;
    assert.equal((await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(route, { method: 'POST', headers, body: JSON.stringify({ ...body, throughSec: 0 }) })).status, 400);
    const began = Date.now();
    const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const result = await response.json() as { data?: WatchedNote; error?: { code: string; message: string } };
    await writeFile(path.join(output, 'response.json'), JSON.stringify({ status: response.status, ...result }, null, 2));
    assert.equal(response.status, 200); assert.ok(result.data); assert.ok(result.data.markdown.trim()); assert.equal(result.data.sources[0].text, source.text);
    assert.equal(result.data.mode, 'source-extract');
    if (storageCase) { assert.ok(result.data.markdown.includes('不能存储')); assert.ok(!result.data.markdown.includes('无需存储')); }
    else assert.ok(result.data.markdown.includes(source.text), 'Actual voice uncertainty must remain verbatim');
    assert.equal(await prisma.generatedNote.count({ where: { contentId } }), 0); assert.equal(await prisma.note.count({ where: { contentId } }), 0);
    const saved = await fetch(base + `/api/contents/${contentId}/notes`, { method: 'POST', headers, body: JSON.stringify({ content: result.data.markdown, ref: { type: 'video', timestampSec: Math.floor(source.startMs / 1000) } }) });
    assert.ok([200, 201].includes(saved.status)); assert.equal(await prisma.note.count({ where: { contentId } }), 1);
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, testCase: storageCase ? 'storage-negation' : 'voice-uncertainty', verbatimExtractMode: true, actualSparkRequest: true, sourceFromExistingVideo: true, canonicalQuoteMatched: true, storageNegationProtected: storageCase, voiceUncertaintyPreserved: !storageCase, futureSourceRejected: true, anonymousRejected: true, generationDidNotPersist: true, explicitSavePassed: true, elapsedMs: Date.now() - began, realBrowserPlaybackTested: false, temporaryFixtureCleaned: false }, null, 2));
  } finally {
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await writeFile(path.join(output, 'cleanup.json'), JSON.stringify({ temporaryOwnerCleaned: await prisma.user.count({ where: { id: ownerId } }) === 0, temporaryContentCleaned: !contentId || await prisma.learningContent.count({ where: { id: contentId } }) === 0, originalSharedMediaNotDeleted: true }, null, 2));
    await prisma.$disconnect();
  }
}
main().catch((): void => { console.error('随看笔记隔离验收失败，检查指定目录的响应证据；未输出凭据。'); process.exitCode = 1; });
