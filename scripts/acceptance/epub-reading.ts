import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { getStorage } from '../../src/lib/storage';
import { signAccessToken } from '../../src/lib/auth/jwt';
import { minimalEpub } from '../../tests/fixtures/minimal-epub';
import type { BookResult, BookView } from '../../src/lib/books/contracts';
loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const db = new PrismaClient(), directory = path.resolve('.taskbook-working/epub-20261018'), base = 'http://127.0.0.1:3000', privatePath = path.join(directory, 'fixture.private.json');
type Fixture = { run: string; owner: string; other: string; account: string; password: string; contents: string[]; keys: string[]; checks: { name: string; status: number }[] };
async function request<T>(fixture: Fixture, name: string, route: string, method = 'GET', body?: unknown, status = 200, asUser = fixture.owner): Promise<T> {
  const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + signAccessToken({ sub: asUser, email: null, role: 'student' }, 3600) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  fixture.checks.push({ name, status: response.status }); assert.equal(response.status, status, name);
  const envelope = await response.json() as { data: T }; return envelope.data;
}
async function save(fixture: Fixture): Promise<void> { await writeFile(privatePath, JSON.stringify(fixture)); }
async function cleanup(fixture: Fixture): Promise<void> {
  assert.ok(/^epub-reading-[a-f0-9-]+$/u.test(fixture.run)); assert.ok([fixture.owner, fixture.other].every((id): boolean => id.startsWith(fixture.run)));
  await db.auditLog.deleteMany({ where: { actorId: { in: [fixture.owner, fixture.other] } } });
  // Only exact recorded synthetic content/object pairs, including a temporary UI fixture attached to the current session.
  await db.learningContent.deleteMany({ where: { id: { in: fixture.contents }, storageKey: { in: fixture.keys }, fileName: { startsWith: '原创阅读样本-' } } });
  await db.user.deleteMany({ where: { id: { in: [fixture.owner, fixture.other] } } });
  for (const key of fixture.keys) { assert.ok(fixture.contents.some((id): boolean => key.startsWith('contents/' + id + '/'))); await getStorage().deleteObject(key); }
  await writeFile(path.join(directory, 'cleanup.json'), JSON.stringify({ usersRemaining: await db.user.count({ where: { id: { in: [fixture.owner, fixture.other] } } }), contentsRemaining: await db.learningContent.count({ where: { id: { in: fixture.contents } } }), onlySyntheticKeys: true }, null, 2)); fixture.password = ''; await save(fixture);
}
async function main(): Promise<void> {
  await mkdir(directory, { recursive: true }); if (process.argv[2] === 'cleanup') { await cleanup(JSON.parse(await readFile(privatePath, 'utf8')) as Fixture); return; }
  assert.equal(process.argv[2], undefined); if (existsSync(privatePath)) assert.equal((JSON.parse(readFileSync(privatePath, 'utf8')) as Fixture).password, '', 'Clean previous fixture first');
  const run = 'epub-reading-' + randomUUID(), fixture: Fixture = { run, owner: run + '-owner', other: run + '-other', account: run + '@example.invalid', password: randomUUID() + '!Aa9', contents: [], keys: [], checks: [] }; await save(fixture);
  try {
    for (const id of [fixture.owner, fixture.other]) await db.user.create({ data: { id, email: id === fixture.owner ? fixture.account : null, nickname: 'EPUB临时验收', role: 'student', passwordHash: await bcrypt.hash(fixture.password, 10) } });
    for (const [index, bytes] of [minimalEpub(), minimalEpub(true), Buffer.from('disguised EPUB')].entries()) {
      const intent = await request<{ contentId: string; uploadUrl: string }>(fixture, 'upload-intent-' + index, '/api/contents/upload-intent', 'POST', { contentType: 'document', fileName: '原创阅读样本-' + index + '.epub', fileSize: bytes.length, mimeType: 'application/epub+zip' }); fixture.contents.push(intent.contentId); await save(fixture);
      const row = await db.learningContent.findUniqueOrThrow({ where: { id: intent.contentId } }); fixture.keys.push(row.storageKey); await save(fixture);
      assert.equal((await fetch(new URL(intent.uploadUrl, base), { method: 'PUT', body: new Uint8Array(bytes), headers: { 'content-type': 'application/epub+zip' }, signal: AbortSignal.timeout(30000) })).status, 200);
      await request(fixture, 'complete-' + index, '/api/contents/' + intent.contentId + '/complete', 'POST', { size: bytes.length, title: index === 0 ? '原创EPUB章节阅读演示' : 'EPUB格式验收-' + index });
      const deadline = Date.now() + 60000; let content = await db.learningContent.findUniqueOrThrow({ where: { id: intent.contentId } });
      while (!['READY', 'FAILED'].includes(content.status) && Date.now() < deadline) { await new Promise<void>((resolve): void => { setTimeout(resolve, 300); }); content = await db.learningContent.findUniqueOrThrow({ where: { id: intent.contentId } }); }
      assert.equal(content.status, index === 2 ? 'FAILED' : 'READY'); assert.equal(content.understandingStatus, 'NONE'); assert.equal(await db.textBlock.count({ where: { contentId: content.id } }), 0);
      if (index === 2) { assert.match(content.failReason ?? '', /EPUB/u); continue; }
      assert.equal(content.pageCount, null); let book = (await request<BookResult>(fixture, 'read-book-' + index, '/api/contents/' + content.id + '/book')).book!; assert.equal(book.unitCount, 28); assert.equal(book.processedCount, 0);
      if (index === 1) { assert.equal(book.chapters.length, 2); continue; }
      const send = async (name: string, action: Record<string, unknown>, status = 200): Promise<BookView> => (await request<BookResult>(fixture, name, '/api/contents/' + content.id + '/book', 'POST', { ...action, expectedRevision: book.revision, requestId: randomUUID(), sourceDigest: book.sourceDigest }, status))?.book ?? book;
      book = await send('extract-only-three', { action: 'extract', start: 14, end: 16 }); assert.equal(book.processedCount, 3); assert.match(book.readingUnits[0].value!.text, /原文第13段/u);
      await send('range-limit', { action: 'extract', start: 1, end: 21 }, 400);
      book = await send('remember-reading', { action: 'cursor', position: 14 }); book = await send('bookmark', { action: 'bookmark', position: 14, label: '深入理解' });
      const notes = '/api/contents/' + content.id + '/notes'; const note = await request<{ ref: unknown }>(fixture, 'paragraph-note', notes, 'POST', { content: '这是原创阅读笔记，定位第14段。', ref: { type: 'document', page: 1, blockIndex: 13 } }); assert.deepEqual(note.ref, { type: 'document', page: 1, blockIndex: 13 });
      await request(fixture, 'invalid-paragraph', notes, 'POST', { content: '无效位置', ref: { type: 'document', page: 1, blockIndex: 28 } }, 400);
      await request(fixture, 'fake-page', notes, 'POST', { content: '伪造页码', ref: { type: 'document', page: 2, blockIndex: 0 } }, 400);
      await request(fixture, 'cross-user-book', '/api/contents/' + content.id + '/book', 'GET', undefined, 403, fixture.other);
      await request(fixture, 'cross-user-notes', notes, 'GET', undefined, 403, fixture.other);
      const summary = await request<{ format: string; pageCount: null }>(fixture, 'content-summary', '/api/contents/' + content.id); assert.equal(summary.format, 'EPUB'); assert.equal(summary.pageCount, null);
      const resource = await request<{ url: string }>(fixture, 'original-resource', '/api/contents/' + content.id + '/resource'); const raw = await fetch(new URL(resource.url, base)); assert.equal(raw.headers.get('content-type'), 'application/epub+zip'); assert.deepEqual(Buffer.from(await raw.arrayBuffer()), bytes);
      assert.equal((await request<BookResult>(fixture, 'reload-reading', '/api/contents/' + content.id + '/book')).book?.cursor, 14);
    }
    await save(fixture); await writeFile(path.join(directory, 'http.json'), JSON.stringify({ checks: fixture.checks, allPassed: true, temporaryOwner: fixture.owner, primaryContent: fixture.contents[0], originalSample: true, realModelCalls: 0, format: 'EPUB3 + EPUB2', malformedRejected: true }, null, 2)); console.log('Real EPUB upload/reader/reference isolation checks passed; temporary fixture retained for browser acceptance.');
  } catch { await save(fixture); await writeFile(path.join(directory, 'http-failure.json'), JSON.stringify({ checks: fixture.checks, status: 'failed' }, null, 2)); await cleanup(fixture); throw new Error('EPUB isolated acceptance failed; safe evidence saved'); }
}
void main().catch((): void => { console.error('EPUB acceptance did not complete; inspect safe evidence.'); process.exitCode = 1; }).finally(async (): Promise<void> => { await db.$disconnect(); });
