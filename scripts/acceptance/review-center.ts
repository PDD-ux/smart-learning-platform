/** Disposable real HTTP/DB acceptance. Shared original media is read-only, never deleted. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { PrismaClient, type Prisma } from '@prisma/client';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const mode = process.argv[2];
const directory = path.resolve(process.argv[3] ?? '.taskbook-working/review-center-20261013/fixture');
if (!['setup', 'check', 'cleanup'].includes(mode) || !directory.startsWith(path.resolve('.taskbook-working') + path.sep)) throw new Error('Use setup|check|cleanup and a new .taskbook-working subdirectory');
const base = 'http://localhost:3000';
type Fixture = { accounts: { id: string; account: string; password: string }[]; cards: string[]; points: string[]; contents: string[]; originalIds: string[]; beforeHash: string };
function stringify(value: unknown): string { return JSON.stringify(value, (_key, item: unknown): unknown => typeof item === 'bigint' ? String(item) : item); }
async function fingerprint(ids: string[]): Promise<string> {
  const rows = await db.learningContent.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, include: {
    owner: { select: { id: true, xpTotal: true } }, notes: { orderBy: { id: 'asc' } }, progress: { orderBy: { id: 'asc' } },
    textBlocks: { orderBy: { id: 'asc' } }, transcripts: { orderBy: { id: 'asc' } }, generatedNote: true,
    knowledgePoints: { orderBy: { id: 'asc' }, include: { masteries: { orderBy: { id: 'asc' } } } },
    flashcards: { orderBy: { id: 'asc' }, include: { reviewLogs: { orderBy: { id: 'asc' } } } },
    exercises: { orderBy: { id: 'asc' }, include: { records: { orderBy: { id: 'asc' } } } }, studyPlans: { orderBy: { id: 'asc' } },
  } });
  return createHash('sha256').update(stringify(rows)).digest('hex');
}
async function save(name: string, value: unknown): Promise<void> { await writeFile(path.join(directory, name), stringify(value)); }
async function main(): Promise<void> {
  if (mode === 'setup') {
    await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory, { recursive: false });
    const { hashPassword } = await import('../../src/lib/auth/password');
    const originalIds = (await db.learningContent.findMany({ select: { id: true } })).map((row): string => row.id);
    const fixture: Fixture = { accounts: [], cards: [], points: [], contents: [], originalIds, beforeHash: await fingerprint(originalIds) };
    const password = `Review-${randomUUID()}!9a`;
    try {
      for (const role of ['student', 'student', 'admin']) {
        const account = `review-${randomUUID()}@example.test`;
        const user = await db.user.create({ data: { email: account, nickname: '复习验收临时' + role, role, passwordHash: await hashPassword(password) } });
        fixture.accounts.push({ id: user.id, account, password }); await save('private-fixture.json', fixture);
      }
      const sourceIds = ['cmuqhyf7h00027q29tijy4uer', 'cmv50hdl7001lzh2svs7pjypg'];
      for (const [index, sourceId] of sourceIds.entries()) {
        const source = await db.learningContent.findUniqueOrThrow({ where: { id: sourceId }, include: {
          knowledgePoints: { orderBy: { createdAt: 'asc' } }, flashcards: true, exercises: true, textBlocks: true, transcripts: true,
        } });
        const point = source.knowledgePoints.find((item): boolean => source.flashcards.some((card): boolean => card.pointId === item.id));
        const card = source.flashcards.find((item): boolean => item.pointId === point?.id);
        if (!point || !card || !Array.isArray(point.refs) || !point.refs.length) throw new Error('Original source needs a point and card');
        const content = await db.learningContent.create({ data: { ownerId: fixture.accounts[0].id, contentType: source.contentType,
          title: `验收用 · ${source.title}`, fileName: source.fileName, format: source.format, storageKey: source.storageKey,
          fileSizeBytes: source.fileSizeBytes, durationSec: source.durationSec, pageCount: source.pageCount, status: 'READY', understandingStatus: 'COMPLETED' } });
        fixture.contents.push(content.id);
        const created = await db.knowledgePoint.create({ data: { ownerId: fixture.accounts[0].id, contentId: content.id,
          title: point.title, summary: point.summary, refs: point.refs as Prisma.InputJsonValue, tags: point.tags, importance: point.importance } });
        fixture.points.push(created.id);
        await db.graphNode.create({ data: { pointId: created.id, nodeType: 'CONCEPT' } });
        // Keep actual source anchors; copies are test-only and never rerun parsing or models.
        const blocks = source.textBlocks.filter((block): boolean => Array.isArray(point.refs) && point.refs.some((ref): boolean => stringify(ref) === stringify(block.ref)));
        if (blocks.length) await db.textBlock.createMany({ data: blocks.map((block, sequence) => ({ contentId: content.id, sequence,
          source: block.source, text: block.text, ref: block.ref as Prisma.InputJsonValue })) });
        const times = (point.refs as { type: string; timestampSec?: number }[]).filter((ref): boolean => ref.type === 'video').map((ref): number => ref.timestampSec ?? -1);
        const transcripts = source.transcripts.filter((segment): boolean => times.includes(Math.floor(segment.startMs / 1000)));
        if (transcripts.length) await db.transcriptSegment.createMany({ data: transcripts.map((segment, seq) => ({ contentId: content.id,
          seq, startMs: segment.startMs, endMs: segment.endMs, text: segment.text })) });
        await db.generatedNote.create({ data: { contentId: content.id, markdown: '# 验收资料\n' + point.summary, sourceCount: 1 } });
        const exercise = source.exercises.find((item): boolean => item.pointId === point.id);
        if (exercise) await db.exercise.create({ data: { contentId: content.id, pointId: created.id, type: exercise.type,
          question: exercise.question, options: exercise.options, correctAnswer: exercise.correctAnswer, explanation: exercise.explanation } });
        for (let duplicate = 0; duplicate < 2; duplicate++) {
          const next = await db.flashcard.create({ data: { contentId: content.id, ownerId: fixture.accounts[0].id, pointId: created.id,
            cardType: 'QA', front: card.front, back: card.back, hint: card.hint, nextReviewAt: new Date(Date.now() - 60_000) } });
          fixture.cards.push(next.id);
        }
        const unrelated = await db.knowledgePoint.create({ data: { ownerId: fixture.accounts[0].id, contentId: content.id,
          title: '人工夹具：不相关知识点', summary: '仅验证精确题目过滤，不作为真实课程产物。', importance: 1, refs: [] } });
        await db.exercise.create({ data: { contentId: content.id, pointId: unrelated.id, type: 'TRUE_FALSE', question: '此题属于不相关知识点。',
          correctAnswer: 'true', explanation: '仅用于过滤隔离验收。' } });
        if (index === 0) await db.flashcard.create({ data: { contentId: content.id, ownerId: fixture.accounts[0].id, pointId: created.id,
          cardType: 'QA', front: '人工夹具：尚未到期自测', back: '用于验证到期过滤。', nextReviewAt: new Date(Date.now() + 86_400_000) } });
        await save('private-fixture.json', fixture);
      }
      await save('setup.json', { ready: true, fixtureUser: fixture.accounts[0].id, contents: fixture.contents,
        points: fixture.points, dueCards: fixture.cards, originalUnchanged: await fingerprint(originalIds) === fixture.beforeHash,
        sharedMediaReadOnly: true, generatedByModelsThisRun: false });
      console.log('Review fixtures ready; credentials remain in private ignored file');
    } catch (error) {
      await db.user.deleteMany({ where: { id: { in: fixture.accounts.map((account): string => account.id) } } });
      await save('setup-failure.json', { cleaned: true, originalUnchanged: await fingerprint(originalIds) === fixture.beforeHash });
      throw error;
    }
    return;
  }
  const fixture = JSON.parse(await readFile(path.join(directory, 'private-fixture.json'), 'utf8')) as Fixture;
  if (mode === 'cleanup') {
    await db.user.deleteMany({ where: { id: { in: fixture.accounts.map((account): string => account.id) } } });
    await save('cleanup.json', { cleaned: await db.user.count({ where: { id: { in: fixture.accounts.map((account): string => account.id) } } }) === 0,
      originalUnchanged: await fingerprint(fixture.originalIds) === fixture.beforeHash, sharedMediaNotDeleted: true });
    console.log('Review fixture accounts cleaned, original media retained'); return;
  }
  const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean): void => { checks.push({ name, passed }); if (!passed) throw new Error(name); };
  const tokenFor = async (index: number): Promise<string> => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: fixture.accounts[index].account, password: fixture.accounts[index].password, remember: false }) });
    check(`login_${index}`, response.status === 200);
    const json = await response.json() as { data: { accessToken: string } }; return json.data.accessToken;
  };
  let currentToken = await tokenFor(0);
  const call = async (route: string, method = 'GET', body?: unknown, expected = 200): Promise<Record<string, unknown>> => {
    const response = await fetch(base + '/api/' + route, { method, headers: { Authorization: `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    check(`${method}_${route}_${expected}`, response.status === expected);
    const json = await response.json() as { data?: Record<string, unknown> }; return json.data ?? {};
  };
  try {
    const due = await call('flashcards?due=true');
    const all = await call('flashcards?due=false');
    check('all_owned_cards', Number(all.total) === 5);
    const items = all.items as { contentTitle: string | null; pointTitle: string | null }[];
    check('real_titles', items.every((item): boolean => Boolean(item.contentTitle && item.pointTitle)));
    for (const [index, pointId] of fixture.points.entries()) {
      const result = await call(`exercises?contentId=${fixture.contents[index]}&pointId=${pointId}`);
      const questions = result.items as { pointId: string; latestRecord: unknown; correctAnswer?: string }[];
      check(`exact_point_${index}`, questions.every((question): boolean => question.pointId === pointId));
      check(`answers_hidden_${index}`, questions.every((question): boolean => !('correctAnswer' in question) && question.latestRecord === null));
    }
    await call(`flashcards/${fixture.cards[0]}/review`, 'POST', { rating: 9 }, 400);
    for (const [index, id] of fixture.cards.entries()) {
      const existing = await db.reviewLog.findFirst({ where: { flashcardId: id } });
      if (!existing) await call(`flashcards/${id}/review`, 'POST', { rating: index });
      const logs = await db.reviewLog.findMany({ where: { flashcardId: id } });
      check(`single_real_review_${index}`, logs.length === 1);
      const stored = await db.flashcard.findUniqueOrThrow({ where: { id } });
      check(`actual_schedule_${index}`, stored.nextReviewAt > new Date());
    }
    check('only_future_card_after_review', Number((await call('flashcards?due=true')).total) === 0);
    check('xp_from_real_logs', (await db.user.findUniqueOrThrow({ where: { id: fixture.accounts[0].id } })).xpTotal
      === (await db.reviewLog.findMany({ where: { flashcardId: { in: fixture.cards } } })).reduce((sum, log): number => sum + [0, 2, 5, 10][log.rating], 0));
    check('mastery_records_written', await db.mastery.count({ where: { learnerId: fixture.accounts[0].id } }) === 2);
    currentToken = await tokenFor(1);
    check('foreign_cards_hidden', Number((await call(`flashcards?contentId=${fixture.contents[0]}`)).total) === 0);
    check('foreign_point_questions_hidden', Number((await call(`exercises?pointId=${fixture.points[0]}`)).total) === 0);
    await call(`flashcards/${fixture.cards[0]}/review`, 'POST', { rating: 3 }, 403);
    await call(`contents/${fixture.contents[0]}/understanding`, 'GET', undefined, 403);
    check('original_data_unchanged', await fingerprint(fixture.originalIds) === fixture.beforeHash);
    await save('check.json', { passed: true, checks, dueBeforeChecks: due.total, verifiedAt: new Date().toISOString() });
    console.log(stringify({ passed: true, checks: checks.length }));
  } catch (error) { await save('check.json', { passed: false, checks }); throw error; }
}
main().catch((error: unknown): void => { console.error(error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[REDACTED]') : 'REVIEW_ACCEPTANCE_FAILED'); process.exitCode = 1; })
  .finally(async (): Promise<void> => { await db.$disconnect(); });
