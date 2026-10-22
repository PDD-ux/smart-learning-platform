import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { signAccessToken } from '../../src/lib/auth/jwt';
import type { BookResult, BookView } from '../../src/lib/books/contracts';
import type { ReadingEntry, ReadingResult } from '../../src/lib/reading-notes/contracts';
import type { TopicAnswer, TopicPreview, TopicView } from '../../src/lib/study-topics/contracts';
import { getStorage } from '../../src/lib/storage';
import type { UrlDraftView } from '../../src/lib/url-imports/contracts';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));

const db = new PrismaClient();
const run = `three-core-learning-${randomUUID()}`;
const owner = `${run}-student`;
const other = `${run}-other`;
const directory = path.resolve('.taskbook-working/phase29-11');
const sourceKey = `acceptance/${run}/original.md`;
const objectKeys = new Set<string>([sourceKey]);
const contentIds = new Set<string>();
const topicIds = new Set<string>();
const videoIds = new Set<string>();
const checks: { name: string; status: number }[] = [];
const base = 'http://127.0.0.1:3000';

async function call<T>(name: string, route: string, method = 'GET', body?: unknown, user: string | null = owner, expected = 200): Promise<T> {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${signAccessToken({ sub: user, email: null, role: 'student' }, 3600)}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(70000),
  });
  checks.push({ name, status: response.status });
  assert.equal(response.status, expected, name);
  if (name !== 'video-complete' && name !== 'video-fixture-delete') {
    assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/u, `${name}: ${response.headers.get('cache-control') ?? 'missing cache-control'}`);
  }
  const json = await response.json() as { data: T };
  return json.data;
}

function bookCommand(book: BookView, action: Record<string, unknown>): Record<string, unknown> {
  return { ...action, expectedRevision: book.revision, requestId: randomUUID(), sourceDigest: book.sourceDigest };
}

async function readAndAnnotate(contentId: string, label: string): Promise<{ chapter: string; quote: string; link: string; resumed: number }> {
  let book = (await call<BookResult>(`${label}-initial-state`, `/api/contents/${contentId}/book`)).book;
  if (!book) book = (await call<BookResult>(`${label}-initialize`, `/api/contents/${contentId}/book`, 'POST', { action: 'initialize', expectedRevision: 0, requestId: randomUUID() })).book;
  assert.ok(book?.chapters.length, `${label} must have an actual chapter index`);
  const chapter = book.chapters[0];
  const end = Math.min(chapter.end, chapter.start + 2);
  book = (await call<BookResult>(`${label}-extract`, `/api/contents/${contentId}/book`, 'POST', bookCommand(book, { action: 'extract', start: chapter.start, end }))).book;
  assert.ok(book?.readableCount, `${label} must have readable source text`);
  const context = (await call<ReadingResult>(`${label}-read`, `/api/contents/${contentId}/reading-notes?start=${chapter.start}&end=${end}`)).context;
  const unit = context.units.find((candidate): boolean => Boolean(candidate.text && candidate.text.length > 20 && !candidate.text.trimStart().startsWith('#')))
    ?? context.units.find((candidate): boolean => Boolean(candidate.text));
  assert.ok(unit?.text);
  const quote = unit.text.slice(0, Math.min(16, unit.text.length));
  const saved = await call<{ entry: ReadingEntry }>(`${label}-excerpt`, `/api/contents/${contentId}/reading-notes`, 'POST', {
    action: 'excerpt', requestId: randomUUID(), sourceDigest: context.sourceDigest, contextDigest: context.digest,
    start: context.start, end: context.end, position: unit.position, offsetStart: 0, offsetEnd: quote.length,
    annotation: '本人演练批注：核对原文后再整理。', tags: ['演练'],
  });
  assert.equal(saved.entry.points[0].quote, quote);
  const exportResult = await call<{ text: string }>(`${label}-export`, `/api/contents/${contentId}/reading-notes/export`, 'POST', { page: 1, removed: false, format: 'md' });
  assert.ok(exportResult.text.includes(quote));
  const link = `/study/${contentId}${book.unitKind === 'page' ? `?page=${unit.position}` : `?page=1&block=${unit.position - 1}`}`;
  assert.ok(exportResult.text.includes(link));
  // Reading-journal writes share BookState CAS; refresh its revision before a book command.
  book = (await call<BookResult>(`${label}-refresh-after-note`, `/api/contents/${contentId}/book`)).book;
  assert.ok(book);
  book = (await call<BookResult>(`${label}-bookmark`, `/api/contents/${contentId}/book`, 'POST', bookCommand(book, { action: 'bookmark', position: unit.position, label: '课堂演练标记' }))).book;
  assert.ok(book);
  book = (await call<BookResult>(`${label}-cursor`, `/api/contents/${contentId}/book`, 'POST', bookCommand(book, { action: 'cursor', position: unit.position }))).book;
  assert.ok(book);
  const resumed = (await call<BookResult>(`${label}-resume`, `/api/contents/${contentId}/book`)).book;
  assert.equal(resumed?.cursor, unit.position);
  await call(`${label}-peer-private`, `/api/contents/${contentId}/reading-notes?start=${chapter.start}&end=${end}`, 'GET', undefined, other, 403);
  return { chapter: chapter.title, quote, link, resumed: resumed.cursor };
}

async function importOriginalVideo(): Promise<{ contentId: string; transcriptCount: number; textBlockCount: number; note: boolean }> {
  const fileName = 'original-lesson.mp4';
  const bytes = await readFile(path.join(directory, fileName));
  const intent = await call<{ contentId: string; uploadUrl: string }>('video-upload-intent', '/api/contents/upload-intent', 'POST', {
    contentType: 'video', fileName, fileSize: bytes.length, mimeType: 'video/mp4',
  });
  videoIds.add(intent.contentId);
  contentIds.add(intent.contentId);
  const upload = await fetch(new URL(intent.uploadUrl, base), {
    method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: bytes, signal: AbortSignal.timeout(60000),
  });
  assert.ok(upload.ok, 'Signed original video upload must succeed');
  await call('video-complete', `/api/contents/${intent.contentId}/complete`, 'POST', { size: bytes.length });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const row = await db.learningContent.findUniqueOrThrow({ where: { id: intent.contentId } });
    const jobs = await db.asyncJob.findMany({ where: { contentId: intent.contentId }, select: { state: true } });
    if (jobs.length && jobs.every((job): boolean => ['SUCCEEDED', 'FAILED'].includes(job.state)) &&
      ['COMPLETED', 'FAILED'].includes(row.understandingStatus)) {
      assert.equal(row.status, 'READY');
      assert.equal(row.understandingStatus, 'COMPLETED');
      const [transcriptCount, textBlockCount, generated] = await Promise.all([
        db.transcriptSegment.count({ where: { contentId: intent.contentId } }),
        db.textBlock.count({ where: { contentId: intent.contentId, source: 'FRAME' } }),
        db.generatedNote.findUnique({ where: { contentId: intent.contentId }, select: { markdown: true } }),
      ]);
      assert.ok(transcriptCount > 0 && textBlockCount > 0 && generated?.markdown.trim(), 'Video needs real ASR, OCR and generated note');
      return { contentId: intent.contentId, transcriptCount, textBlockCount, note: true };
    }
    await new Promise<void>((resolve): void => { setTimeout(resolve, 5000); });
  }
  throw new Error('Original video pipeline did not reach a terminal state in four minutes; preserve the fixture for inspection');
}

async function main(): Promise<void> {
  await mkdir(directory, { recursive: true });
  let cleanup: { users: number; contents: number; drafts: number; topics: number; objects: number } | null = null;
  let videoResult: Awaited<ReturnType<typeof importOriginalVideo>> | null = null;
  try {
    for (const id of [owner, other]) await db.user.create({ data: { id, role: 'student', nickname: '三主线连续验收', passwordHash: await bcrypt.hash(randomUUID(), 10) } });
    if (process.argv.includes('--with-video')) videoResult = await importOriginalVideo();
    const text = '# 第一章 函数定义\n\n函数描述一个集合中的输入与另一集合中的输出之间的对应关系。\n\n对定义域中的每个输入，函数必须给出唯一的输出。JavaScript 学习时也应区分这个数学定义与程序函数。\n\n# 第二章 应用\n\n判断一个对应是否为函数，要核对定义域和唯一性。';
    const bytes = Buffer.from(text);
    await getStorage().putObject(sourceKey, bytes, { contentType: 'text/markdown;charset=utf-8' });
    const source = await db.learningContent.create({ data: { ownerId: owner, contentType: 'DOCUMENT', title: '原创函数小课阅读稿（临时）', fileName: 'original.md', format: 'MD', storageKey: sourceKey, fileSizeBytes: BigInt(bytes.length), pageCount: 1, status: 'READY' } });
    contentIds.add(source.id);
    const book = await readAndAnnotate(source.id, 'original-book');

    const url = 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Functions';
    const requestId = randomUUID();
    const preview = await call<UrlDraftView>('public-url-preview', '/api/url-imports', 'POST', { requestId, url });
    assert.equal(preview.state, 'PREVIEW');
    assert.equal(preview.preview?.source.requestedUrl, url);
    assert.ok(preview.preview.excerpt);
    assert.equal(await db.learningContent.count({ where: { ownerId: owner } }), videoResult ? 2 : 1, 'Preview must not save another content');
    await call('peer-url-private', `/api/url-imports/${requestId}`, 'GET', undefined, other, 404);
    const confirmed = await call<UrlDraftView>('public-url-confirm', `/api/url-imports/${requestId}/confirm`, 'POST', { confirmed: true, mode: 'reuse' });
    assert.ok(confirmed.contentId);
    contentIds.add(confirmed.contentId);
    const urlRow = await db.learningContent.findUniqueOrThrow({ where: { id: confirmed.contentId } });
    objectKeys.add(urlRow.storageKey);
    const sourceData = await call<{ source: { requestedUrl: string; sourceDigest: string } }>('public-url-resource', `/api/contents/${confirmed.contentId}/resource`);
    assert.equal(sourceData.source.requestedUrl, url);
    const urlBook = await readAndAnnotate(confirmed.contentId, 'public-url-book');
    let urlIndex = (await call<BookResult>('public-url-chapter-index', `/api/contents/${confirmed.contentId}/book`)).book;
    assert.ok(urlIndex);
    const functionChapter = urlIndex.chapters.find((item): boolean => item.start > 1 && item.title === '函数');
    assert.ok(functionChapter, 'Public article must have a substantive function chapter');
    urlIndex = (await call<BookResult>('public-url-select-function-chapter', `/api/contents/${confirmed.contentId}/book`, 'POST',
      bookCommand(urlIndex, { action: 'extract', start: functionChapter.start, end: functionChapter.end }))).book;
    assert.ok(urlIndex);
    const createTopic = { requestId: randomUUID(), title: '原创课文与公开文章联合核对', sources: [
      { contentId: source.id, mode: 'parsed' }, { contentId: confirmed.contentId, mode: 'range', start: functionChapter.start, end: functionChapter.end },
    ] };
    const topic = await call<TopicView>('two-source-topic-create', '/api/study-topics', 'POST', createTopic);
    topicIds.add(topic.id);
    await call('two-source-topic-peer-private', `/api/study-topics/${topic.id}`, 'GET', undefined, other, 404);
    const question = '原创课文与 MDN 文章分别怎样描述函数的输入和输出？请从两份来源各选一处原文。';
    let topicPreview = (await call<{ preview: TopicPreview }>('two-source-topic-preview', `/api/study-topics/${topic.id}`, 'POST', { action: 'preview', question })).preview;
    assert.equal(new Set(topicPreview.evidence.map((item): string => item.contentId)).size, 2, 'Both original sources must be retrievable');
    if (process.argv.includes('--preview-only')) {
      await writeFile(path.join(directory, 'three-core-learning-topic-preview.json'), JSON.stringify(topicPreview, null, 2));
      return;
    }
    const attempts: Array<{ state: TopicAnswer['state']; reason: string | null; citedSources: number }> = [];
    let answer: TopicAnswer | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) topicPreview = (await call<{ preview: TopicPreview }>(`two-source-topic-preview-retry-${attempt}`, `/api/study-topics/${topic.id}`, 'POST', { action: 'preview', question })).preview;
      answer = (await call<{ answer: TopicAnswer }>(`two-source-topic-ask-${attempt}`, `/api/study-topics/${topic.id}`, 'POST', {
        action: 'ask', requestId: randomUUID(), question, scopeDigest: topicPreview.scopeDigest, confirmed: true,
      })).answer;
      const citedSources = new Set(answer.citations.map((item): string => item.contentId)).size;
      attempts.push({ state: answer.state, reason: answer.reason, citedSources });
      if (answer.state === 'READY' && citedSources === 2) break;
    }
    assert.ok(answer);
    await writeFile(path.join(directory, 'three-core-learning-topic-diagnostic.json'), JSON.stringify({
      question, attempts,
      evidence: topicPreview.evidence.map((item): { id: string; contentId: string; text: string } => ({ id: item.id, contentId: item.contentId, text: item.text })),
      citations: answer.citations,
    }, null, 2));
    assert.equal(answer.state, 'READY', 'Real Spark Lite answer must pass quote validation');
    assert.equal(new Set(answer.citations.map((item): string => item.contentId)).size, 2, 'Both sources must be quoted');
    for (const citation of answer.citations) {
      const evidence = topicPreview.evidence.find((item): boolean => item.id === citation.id);
      assert.ok(evidence, 'Citation must refer to preview evidence');
      assert.equal(evidence.text.slice(citation.offset - evidence.offset, citation.offset - evidence.offset + citation.quote.length), citation.quote);
    }
    const report = { time: new Date().toISOString(), state: 'PASSED', sameTemporaryStudent: true, video: videoResult, originalBook: book,
      publicUrl: { requestedUrl: url, sourceDigest: sourceData.source.sourceDigest, ...urlBook },
      twoSourceQuestion: { state: answer.state, attempts, coverage: topicPreview.coverage, citationCount: answer.citations.length, quotedContentIds: [...new Set(answer.citations.map((item): string => item.contentId))] }, checks };
    await writeFile(path.join(directory, 'three-core-learning.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ state: report.state, checks: checks.length, sameTemporaryStudent: true }));
  } finally {
    for (const id of videoIds) {
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const jobs = await db.asyncJob.findMany({ where: { contentId: id }, select: { state: true } });
        if (jobs.every((job): boolean => ['SUCCEEDED', 'FAILED'].includes(job.state))) break;
        await new Promise<void>((resolve): void => { setTimeout(resolve, 5000); });
      }
      const jobs = await db.asyncJob.findMany({ where: { contentId: id }, select: { state: true } });
      if (jobs.some((job): boolean => !['SUCCEEDED', 'FAILED'].includes(job.state))) throw new Error('Video job still running; keep temporary account and content for safe inspection');
      await call('video-fixture-delete', `/api/contents/${id}`, 'DELETE');
    }
    for (const row of await db.learningContent.findMany({ where: { ownerId: owner }, select: { id: true, storageKey: true } })) {
      contentIds.add(row.id);
      if (row.storageKey === sourceKey || row.storageKey.startsWith('contents/url-')) objectKeys.add(row.storageKey);
    }
    await db.auditLog.deleteMany({ where: { actorId: { in: [owner, other] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
    for (const key of objectKeys) {
      assert.ok(key === sourceKey || key.startsWith('contents/url-'), 'Only this run source and URL objects may be removed');
      await getStorage().deleteObject(key);
    }
    cleanup = { users: await db.user.count({ where: { id: { in: [owner, other] } } }), contents: await db.learningContent.count({ where: { id: { in: [...contentIds] } } }), drafts: await db.urlImportDraft.count({ where: { ownerId: owner } }), topics: await db.studyTopic.count({ where: { id: { in: [...topicIds] } } }), objects: objectKeys.size };
    await writeFile(path.join(directory, 'three-core-learning-cleanup.json'), JSON.stringify(cleanup, null, 2));
    assert.equal(cleanup.users + cleanup.contents + cleanup.drafts + cleanup.topics, 0, 'Synthetic data must be removed');
    await db.$disconnect();
  }
}

void main().catch((error: unknown): void => { console.error(error instanceof Error ? error.message : 'Three-core learning acceptance failed'); process.exitCode = 1; });
