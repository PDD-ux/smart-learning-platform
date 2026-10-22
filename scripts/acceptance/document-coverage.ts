/** Real document batches on disposable data; explicit append-only repair after success. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { PrismaClient, Prisma } from '@prisma/client';

loadEnvConfig(process.cwd(), true);
let db: PrismaClient;
const mode = process.argv[2];
const sourceId = process.argv[3];
const output = path.resolve(process.argv[4] ?? '.taskbook-working/document-coverage-20261012/real');
const root = path.resolve('.taskbook-working');
if (!['run', 'preview', 'apply'].includes(mode) || !sourceId || !output.startsWith(root + path.sep)) throw new Error('Usage: document-coverage.ts run|preview|apply contentId .taskbook-working/new-directory');
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown): unknown => typeof item === 'bigint' ? String(item) : item, 2);
}
function digest(value: unknown): string { return createHash('sha256').update(serialize(value)).digest('hex'); }
async function snapshot(ids: string[]): Promise<unknown> {
  return db.learningContent.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, include: {
    textBlocks: { orderBy: { id: 'asc' } }, transcripts: { orderBy: { id: 'asc' } }, notes: { orderBy: { id: 'asc' } },
    knowledgePoints: { orderBy: { id: 'asc' }, include: { masteries: { orderBy: { id: 'asc' } }, graphNode: true } },
    flashcards: { orderBy: { id: 'asc' }, include: { reviewLogs: { orderBy: { id: 'asc' } } } },
    exercises: { orderBy: { id: 'asc' }, include: { records: { orderBy: { id: 'asc' } } } },
    progress: { orderBy: { id: 'asc' } }, studyPlans: { orderBy: { id: 'asc' } }, generatedNote: true, graphEdges: { orderBy: { id: 'asc' } },
  } });
}
function protectedSnapshot(value: unknown, pointIds: string[], cardIds: string[]): unknown {
  const rows = JSON.parse(serialize(value)) as Record<string, unknown>[];
  return rows.map((row): Record<string, unknown> => {
    if (row.id !== sourceId) return row;
    const { generatedNote: _note, ...rest } = row;
    rest.knowledgePoints = (row.knowledgePoints as { id: string }[]).filter((point): boolean => pointIds.includes(point.id));
    rest.flashcards = (row.flashcards as { id: string }[]).filter((card): boolean => cardIds.includes(card.id));
    return rest;
  });
}
async function main(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  db = new PrismaClient();
  const { deepExtractStage, knowledgeExtractionSchema } = await import('../../src/lib/jobs/pipeline/deep-extract.stage');
  const { productGenStage, flashcardGenerationSchema } = await import('../../src/lib/jobs/pipeline/product-gen.stage');
  const { buildStructuredContext } = await import('../../src/lib/jobs/pipeline/context-builder');
  const { documentContexts, documentModelProvider } = await import('../../src/lib/jobs/pipeline/document-context');
  const { generateStructuredNote } = await import('../../src/lib/domain/generated-note');
  const { contentRefSchema } = await import('../../src/lib/domain/content-ref');
  const source = await db.learningContent.findUniqueOrThrow({ where: { id: sourceId }, include: {
    textBlocks: { orderBy: { sequence: 'asc' } }, knowledgePoints: { orderBy: { id: 'asc' } }, flashcards: { orderBy: { id: 'asc' } },
  } });
  if (source.format !== 'PDF' || source.status !== 'READY') throw new Error('Ready PDF required');
  const sourceHash = digest(source.textBlocks);
  const oldProductsHash = digest({ points: source.knowledgePoints, cards: source.flashcards });
  if (mode === 'run') {
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output, { recursive: false });
    const ids = (await db.learningContent.findMany({ select: { id: true } })).map((row): string => row.id);
    const before = await snapshot(ids);
    await writeFile(path.join(output, 'before.json'), serialize(before));
    const contexts = documentContexts(await buildStructuredContext(sourceId, Number.MAX_SAFE_INTEGER), source.pageCount);
    const coverage = contexts.map((context, index) => ({ index, characters: context.sourceSegments.reduce((sum, segment): number => sum + segment.text.length, 0),
      pages: [...new Set(context.sourceRefs.flatMap((ref): number[] => ref.type === 'document' ? [ref.page] : []))] }));
    await writeFile(path.join(output, 'batches.json'), serialize(coverage));
    let fixtureUser = '';
    let passed = false;
    let failureCode = '';
    let failureDetail = '';
    let pointCount = 0;
    let cardCount = 0;
    let citedPages: number[] = [];
    const started = Date.now();
    const originalFetch = globalThis.fetch;
    let responseIndex = 0;
    const submittedContexts = new Set<string>();
    const submittedPages = new Set<number>();
    let submittedCharacters = 0;
    globalThis.fetch = async (input, init): Promise<Response> => {
      if (String(input).endsWith('/chat/completions') && (responseIndex >= 70 || Date.now() - started >= 600_000)) {
        throw new Error('DOCUMENT_ACCEPTANCE_REQUEST_BUDGET_EXCEEDED');
      }
      if (String(input).endsWith('/chat/completions') && typeof init?.body === 'string') {
        const request = JSON.parse(init.body) as { messages?: { content?: string }[] };
        const sourceMessage = request.messages?.[1]?.content ?? '';
        const prefix = '以下为本次保留的真实来源，只选择支持摘要的编号：';
        const end = sourceMessage.indexOf('\n学习者笔记');
        if (sourceMessage.startsWith(prefix) && end > prefix.length) {
          const encoded = sourceMessage.slice(prefix.length, end);
          if (!submittedContexts.has(encoded)) {
            const sources = JSON.parse(encoded) as { text: string; ref: { type: string; page?: number } }[];
            submittedContexts.add(encoded);
            submittedCharacters += sources.reduce((sum, source): number => sum + source.text.length, 0);
            for (const source of sources) if (source.ref.type === 'document' && typeof source.ref.page === 'number') submittedPages.add(source.ref.page);
          }
        }
      }
      const response = await originalFetch(input, init);
      if (String(input).endsWith('/chat/completions')) {
        const json = await response.clone().json().catch((): Record<string, never> => ({})) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
        await writeFile(path.join(output, `model-${++responseIndex}.json`), serialize({ status: response.status,
          content: json.choices?.[0]?.message?.content, usage: json.usage }));
        console.log(serialize({ modelResponse: responseIndex, httpStatus: response.status, elapsedMs: Date.now() - started }));
      }
      return response;
    };
    try {
      const user = await db.user.create({ data: { email: `doc-${randomUUID()}@example.test`, nickname: '文档验收隔离账号', passwordHash: 'unusable-disposable-account' } });
      fixtureUser = user.id;
      const fixture = await db.learningContent.create({ data: { ownerId: user.id, contentType: 'DOCUMENT', title: '222页文档隔离理解验收',
        fileName: source.fileName, format: 'PDF', fileSizeBytes: source.fileSizeBytes, storageKey: `acceptance/${randomUUID()}.pdf`,
        pageCount: source.pageCount, status: 'READY' } });
      await db.textBlock.createMany({ data: source.textBlocks.map((block) => ({ contentId: fixture.id, sequence: block.sequence,
        text: block.text, source: block.source, ref: block.ref as Prisma.InputJsonValue })) });
      const ctx = { contentId: fixture.id, traceId: randomUUID(), degraded: { infer: false, asr: false } };
      await deepExtractStage(ctx);
      await productGenStage(ctx);
      const points = await db.knowledgePoint.findMany({ where: { contentId: fixture.id }, orderBy: { createdAt: 'asc' } });
      const cards = await db.flashcard.findMany({ where: { contentId: fixture.id }, orderBy: { createdAt: 'asc' } });
      const note = await db.generatedNote.findUnique({ where: { contentId: fixture.id } });
      pointCount = points.length; cardCount = cards.length;
      citedPages = [...new Set(points.flatMap((point): number[] => Array.isArray(point.refs) ? point.refs.flatMap((ref): number[] => {
        if (ref && typeof ref === 'object' && 'page' in ref && typeof ref.page === 'number') return [ref.page]; return [];
      }) : []))].sort((a, b): number => a - b);
      const submittedCharacters = coverage.reduce((sum, batch): number => sum + batch.characters, 0);
      if (submittedCharacters !== source.textBlocks.reduce((sum, block): number => sum + block.text.length, 0)
        || cardCount !== pointCount || note?.sourceCount !== pointCount || !citedPages.some((page): boolean => page <= 20)
        || !citedPages.some((page): boolean => page >= 90 && page <= 140) || !citedPages.some((page): boolean => page >= 200)) throw new Error('COVERAGE_OR_PRODUCTS_INVALID');
      await writeFile(path.join(output, 'products.json'), serialize({ points, cards, note }));
      passed = true;
    } catch (error) {
      failureCode = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'UNKNOWN';
      failureDetail = error instanceof Error ? error.message.slice(0, 400) : 'UNKNOWN';
    } finally {
      globalThis.fetch = originalFetch;
      if (fixtureUser) await db.user.delete({ where: { id: fixtureUser } });
      const after = await snapshot(ids);
      const unchanged = digest(before) === digest(after);
      await writeFile(path.join(output, 'report.json'), serialize({ sourceId, sourceHash, oldProductsHash, provider: documentModelProvider(),
        passed: passed && unchanged, failureCode, failureDetail, batches: coverage.length, plannedPages: [...new Set(coverage.flatMap((batch) => batch.pages))].length,
        plannedCharacters: coverage.reduce((sum, batch): number => sum + batch.characters, 0), submittedBatches: submittedContexts.size,
        submittedPages: submittedPages.size, submittedCharacters, pointCount, cardCount, citedPages,
        durationMs: Date.now() - started, modelResponses: responseIndex, beforeHash: digest(before), afterHash: digest(after), originalUnchanged: unchanged,
        cleanup: !await db.user.findUnique({ where: { id: fixtureUser } }) }));
      console.log(serialize({ passed: passed && unchanged, failureCode, pointCount, cardCount, citedPages, originalUnchanged: unchanged }));
      if (!passed || !unchanged) process.exitCode = 1;
    }
    return;
  }
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')) as { passed: boolean; sourceId: string; sourceHash: string; oldProductsHash: string };
  if (!report.passed || report.sourceId !== sourceId || report.sourceHash !== sourceHash || report.oldProductsHash !== oldProductsHash) throw new Error('Accepted source/products changed; rerun or review before repair');
  const raw = JSON.parse(await readFile(path.join(output, 'products.json'), 'utf8')) as { points: { id: string; title: string; summary: string; tags: string[]; importance: number; refs: Prisma.InputJsonValue }[];
    cards: { pointId: string; front: string; back: string; hint: string | null }[] };
  // Validate in small bounded batches; total output may exceed one model-call schema cap.
  for (let index = 0; index < raw.points.length; index += 20) knowledgeExtractionSchema.parse({ points: raw.points.slice(index, index + 20) });
  const cards = raw.cards.flatMap((card) => flashcardGenerationSchema.parse({ cards: [{ ...card, hint: card.hint ?? undefined,
    pointIndex: raw.points.findIndex((point): boolean => point.id === card.pointId) }] }).cards);
  if (cards.some((card): boolean => card.pointIndex < 0 || card.pointIndex >= raw.points.length)
    || new Set(cards.map((card): number => card.pointIndex)).size !== raw.points.length || cards.length !== raw.points.length) throw new Error('Artifact cards invalid');
  const allowedRefs = source.textBlocks.map((block) => contentRefSchema.parse(block.ref));
  if (raw.points.some((point): boolean => !Array.isArray(point.refs) || !point.refs.length
    || point.refs.some((ref): boolean => {
      const parsed = contentRefSchema.parse(ref);
      return !allowedRefs.some((allowed): boolean => parsed.type === 'document' && allowed.type === 'document'
        && parsed.page === allowed.page && (parsed.blockIndex === undefined || parsed.blockIndex === allowed.blockIndex));
    }))) throw new Error('Artifact citations outside source');
  console.log(serialize({ mode, sourceId, existingPoints: source.knowledgePoints.length, addPoints: raw.points.length, addCards: cards.length }));
  if (mode !== 'apply') return;
  const allIds = (await db.learningContent.findMany({ select: { id: true } })).map((row): string => row.id);
  const xpBefore = await db.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, xpTotal: true } });
  const before = await snapshot(allIds);
  await writeFile(path.join(output, 'before-apply.json'), serialize(before), { flag: 'wx' });
  const protectedBefore = await snapshot(allIds.filter((id): boolean => id !== sourceId));
  await db.$transaction(async (tx): Promise<void> => {
    const current = await tx.learningContent.findUniqueOrThrow({ where: { id: sourceId }, include: {
      textBlocks: { orderBy: { sequence: 'asc' } }, knowledgePoints: { orderBy: { id: 'asc' } }, flashcards: { orderBy: { id: 'asc' } } } });
    if (digest(current.textBlocks) !== sourceHash || digest({ points: current.knowledgePoints, cards: current.flashcards }) !== oldProductsHash) throw new Error('Concurrent source/products change');
    const mapped = new Map<number, string>();
    for (const [index, point] of raw.points.entries()) {
      const created = await tx.knowledgePoint.create({ data: { contentId: sourceId, ownerId: source.ownerId,
        title: point.title, summary: point.summary, tags: point.tags, importance: point.importance, refs: point.refs } });
      mapped.set(index, created.id);
      await tx.graphNode.create({ data: { pointId: created.id, nodeType: 'CONCEPT' } });
    }
    for (const card of cards) await tx.flashcard.create({ data: { contentId: sourceId, ownerId: source.ownerId,
      pointId: mapped.get(card.pointIndex)!, front: card.front, back: card.back, hint: card.hint ?? null, cardType: 'QA', status: 'NEW' } });
    await generateStructuredNote(sourceId, tx);
  }, { timeout: 30_000, isolationLevel: 'Serializable' });
  const after = await snapshot(allIds);
  await writeFile(path.join(output, 'after-apply.json'), serialize(after));
  const oldPoints = await db.knowledgePoint.findMany({ where: { id: { in: source.knowledgePoints.map((point): string => point.id) } }, orderBy: { id: 'asc' } });
  const oldCards = await db.flashcard.findMany({ where: { id: { in: source.flashcards.map((card): string => card.id) } }, orderBy: { id: 'asc' } });
  const oldProductsUnchanged = digest({ points: oldPoints, cards: oldCards }) === oldProductsHash;
  const otherContentsUnchanged = digest(protectedBefore) === digest(await snapshot(allIds.filter((id): boolean => id !== sourceId)));
  const protectedLearningUnchanged = digest(protectedSnapshot(before, source.knowledgePoints.map((point): string => point.id), source.flashcards.map((card): string => card.id)))
    === digest(protectedSnapshot(after, source.knowledgePoints.map((point): string => point.id), source.flashcards.map((card): string => card.id)));
  const xpUnchanged = digest(xpBefore) === digest(await db.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, xpTotal: true } }));
  await writeFile(path.join(output, 'apply-report.json'), serialize({ sourceId, addedPoints: raw.points.length, addedCards: cards.length,
    oldProductsUnchanged, otherContentsUnchanged, protectedLearningUnchanged, xpUnchanged, completedAt: new Date().toISOString() }));
  if (!oldProductsUnchanged || !otherContentsUnchanged || !protectedLearningUnchanged || !xpUnchanged) throw new Error('Repair preservation verification failed');
}
main().catch((error: unknown): void => { console.error(error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]') : 'DOCUMENT_ACCEPTANCE_FAILED'); process.exitCode = 1; })
  .finally(async (): Promise<void> => { if (db) await db.$disconnect(); });
