import { loadEnvConfig } from '@next/env';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { signAccessToken } from '../../src/lib/auth/jwt';
import { homeworkGradingHandlers } from '../../src/lib/homework/grading-routes';
import { commandHomeworkGradingReport, createHomeworkGradingReport, listHomeworkGradingReports, listHomeworkMistakes, runHomeworkGradingReport } from '../../src/lib/homework/grading-service';
import type { HomeworkGradingResult, ReportCommand, ReportCreateInput } from '../../src/lib/homework/grading-contracts';
import type { HomeworkQuestion } from '../../src/lib/homework/contracts';
import { getRedis } from '../../src/lib/redis';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));

const root = '.taskbook-working/homework-grading-20261020';
mkdirSync(root, { recursive: true });
const checks: string[] = [];
function checked(name: string): void { checks.push(name); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function safeCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{3,40}$/u.test(error.code)) return error.code;
  return 'UNEXPECTED';
}
async function denied(name: string, work: () => Promise<unknown>, code?: string): Promise<void> {
  await assert.rejects(work, (error: unknown): boolean => !code || !!error && typeof error === 'object' && 'code' in error && error.code === code);
  checked(name);
}
async function snapshot(db: PrismaClient): Promise<Array<{ name: string; count: string; digest: string }>> {
  const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`;
  const result: Array<{ name: string; count: string; digest: string }> = [];
  for (const { name } of tables) {
    assert.match(name, /^[A-Za-z0-9_]+$/u);
    const [row] = await db.$queryRawUnsafe<Array<{ count: string; digest: string }>>(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "${name}" t`);
    result.push({ name, ...row });
  }
  return result;
}
function envDigest(): string[] { return ['.env', '.env.local'].map((file): string => hash(readFileSync(file, 'utf8'))); }
function migrate(url: string): void {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  assert.equal(result.status, 0, `isolated/additive migration failed (${result.status ?? result.error?.name ?? 'unknown'})`);
}
function token(userId: string, role: 'student' | 'admin'): string { return signAccessToken({ sub: userId, email: null, role }); }
function request(url: string, method: 'GET' | 'POST', bearer?: string, body?: unknown): NextRequest {
  return new NextRequest(url, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise<void>((resolve): void => { setTimeout(resolve, 50); });
  }
  throw new Error('timed out waiting for isolated report transition');
}

const questions: HomeworkQuestion[] = [
  { number: '1', type: 'choice', prompt: '有理数中，下列哪个是偶数？A. 3 B. 4 C. 5', answer: 'A', referenceAnswer: 'B', basis: '选项B对应4，4能被2整除。', reviewed: true },
  { number: '2', type: 'short', prompt: '说明函数定义中自变量与函数值的对应要求。', answer: '一个自变量可以对应多个函数值。', referenceAnswer: '定义域中的每一个自变量，按照对应法则，在值域中都有唯一确定的函数值与之对应。', basis: '本人提供依据：每一个自变量唯一对应一个函数值。', reviewed: true },
];

async function exercise(db: PrismaClient): Promise<{ modelStatus: string; modelCode: string | null; modelMs: number | null; modelAssessment: string | null; modelSuggestedScore: number | null; correctionStatus: string | null; correctionCode: string | null; correctionAssessment: string | null; correctionSuggestedScore: number | null; semanticSamplePassed: boolean }> {
  const ownerId = randomUUID(), peerId = randomUUID(), adminId = randomUUID(), draftId = randomUUID();
  for (const [id, role] of [[ownerId, 'student'], [peerId, 'student'], [adminId, 'admin']] as const) {
    await db.user.create({ data: { id, role, nickname: `grading-${id.slice(0, 8)}`, email: `${id}@grading.invalid`, passwordHash: 'isolated-no-login' } });
  }
  await db.homeworkDraft.create({ data: { id: draftId, ownerId, title: '合成课堂作业批改验收', createDigest: hash('synthetic-homework-grading-v1'), source: { kind: 'text', label: '仅供隔离验收的合成输入' }, state: 'CONFIRMED', revision: 1, rawText: '合成测试材料', questions: questions as unknown as Prisma.InputJsonValue } });
  const protectedBefore = await snapshot(db);
  const handlers = homeworkGradingHandlers(db);
  const ownerToken = token(ownerId, 'student'), peerToken = token(peerId, 'student'), adminToken = token(adminId, 'admin');
  const baseUrl = `http://local/api/homework/${draftId}/grading`;
  assert.equal((await handlers.LIST(request(baseUrl, 'GET'), { params: Promise.resolve({ id: draftId }) })).status, 401); checked('unauthenticated report read rejected');
  assert.equal((await handlers.LIST(request(baseUrl, 'GET', peerToken), { params: Promise.resolve({ id: draftId }) })).status, 404); checked('peer report read hidden as not found');
  assert.equal((await handlers.LIST(request(baseUrl, 'GET', adminToken), { params: Promise.resolve({ id: draftId }) })).status, 404); checked('administrator has no student report bypass');
  const noConsent: Omit<ReportCreateInput, 'consent'> = { requestId: randomUUID(), expectedDraftRevision: 1, questionNumbers: ['1'] };
  const deniedConsent = await handlers.CREATE(request(baseUrl, 'POST', ownerToken, noConsent), { params: Promise.resolve({ id: draftId }) });
  assert.notEqual(deniedConsent.status, 200); assert.equal(await db.homeworkGradingReport.count({ where: { draftId } }), 0); checked('server refuses report reservation without explicit consent');
  await denied('peer service cannot create a report', () => createHomeworkGradingReport(peerId, draftId, { ...noConsent, consent: true }, db), 'NOT_FOUND');
  await denied('admin service cannot create a report', () => createHomeworkGradingReport(adminId, draftId, { ...noConsent, consent: true }, db), 'NOT_FOUND');
  await denied('report rejects absent consent', () => createHomeworkGradingReport(ownerId, draftId, noConsent, db), 'VALIDATION_FAILED');
  await denied('report rejects more than eight selected questions', () => createHomeworkGradingReport(ownerId, draftId, { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: Array.from({ length: 9 }, (_value, index): string => String(index + 1)) }, db), 'VALIDATION_FAILED');
  checked('bounded report selection contract');

  const createInput: ReportCreateInput = { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: ['1'] };
  const created = await createHomeworkGradingReport(ownerId, draftId, createInput, db);
  assert.equal(created.state, 'PENDING'); assert.deepEqual(created.questionNumbers, ['1']);
  assert.deepEqual(await createHomeworkGradingReport(ownerId, draftId, createInput, db), created); checked('report creation idempotency and frozen question set');
  await denied('same request key cannot change selected questions', () => createHomeworkGradingReport(ownerId, draftId, { ...createInput, questionNumbers: ['2'] }, db), 'CLASSROOM_CONFLICT');
  const listed = await listHomeworkGradingReports(ownerId, draftId, db); assert.equal(listed.items[0]?.id, created.id); assert.ok(!JSON.stringify(listed).includes('sourceDigest')); checked('report DTO omits internal source fingerprints');

  const cancelInput: ReportCreateInput = { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: ['1'] };
  const pending = await createHomeworkGradingReport(ownerId, draftId, cancelInput, db);
  const cancelled = await commandHomeworkGradingReport(ownerId, draftId, pending.id, { action: 'cancel', target: 'analysis', requestId: randomUUID(), expectedRevision: pending.revision }, undefined, db);
  assert.equal(cancelled.state, 'CANCELLED'); assert.equal((await runHomeworkGradingReport(ownerId, draftId, pending.id, undefined, db)).state, 'CANCELLED'); checked('pending cancellation prevents any model call on replay');

  const lateInput: ReportCreateInput = { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: ['1'] };
  const late = await createHomeworkGradingReport(ownerId, draftId, lateInput, db);
  let release: (value: HomeworkGradingResult) => void = (): void => undefined;
  let entered: () => void = (): void => undefined;
  const started = new Promise<void>((resolve): void => { entered = resolve; });
  const waiting = new Promise<HomeworkGradingResult>((resolve): void => { release = resolve; });
  const lateRun = runHomeworkGradingReport(ownerId, draftId, late.id, undefined, db, async (selected): Promise<HomeworkGradingResult> => { entered(); return waiting.then((value): HomeworkGradingResult => { assert.equal(selected[0]?.number, '1'); return value; }); });
  await started;
  const running = await listHomeworkGradingReports(ownerId, draftId, db).then((value) => value.items.find((item) => item.id === late.id));
  assert.ok(running); const lateCancel: ReportCommand = { action: 'cancel', target: 'analysis', requestId: randomUUID(), expectedRevision: running.revision };
  await commandHomeworkGradingReport(ownerId, draftId, late.id, lateCancel, undefined, db);
  release({ items: [{ number: '1', assessment: 'correct', suggestedScore: 100, errorCause: 'none', reason: '依据内容与答案一致。', evidenceQuote: 'B', nextStep: '继续练习。', objectiveMatch: 'match', objectiveScore: 100 }] });
  const lateResult = await lateRun; assert.equal(lateResult.state, 'CANCELLED'); assert.equal(lateResult.result, null); checked('late model result cannot overwrite an explicit cancellation');

  let modelStatus = 'SKIPPED', modelCode: string | null = null, modelMs: number | null = null, modelAssessment: string | null = null, modelSuggestedScore: number | null = null, correctionStatus: string | null = null, correctionCode: string | null = null, correctionAssessment: string | null = null, correctionSuggestedScore: number | null = null, semanticSamplePassed = false;
  const startedAt = Date.now();
  const runningAnalysis = runHomeworkGradingReport(ownerId, draftId, created.id, undefined, db);
  await waitFor(async (): Promise<boolean> => (await db.homeworkGradingReport.findUnique({ where: { id: created.id }, select: { state: true } }))?.state === 'RUNNING');
  const duplicateRun = await runHomeworkGradingReport(ownerId, draftId, created.id, undefined, db);
  assert.equal(duplicateRun.state, 'RUNNING'); checked('concurrent run replay does not claim the same pending report twice');
  const report = await runningAnalysis; modelMs = Date.now() - startedAt; modelStatus = report.state;
  if (report.state === 'READY' && report.result) {
    assert.deepEqual(report.result.items.map((item): string => item.number).sort(), ['1']);
    const originalGrade = report.result.items.find((item): boolean => item.number === '1');
    assert.ok(originalGrade);
    assert.equal(originalGrade.objectiveMatch, 'mismatch');
    assert.ok((originalGrade.assessment === 'incorrect' && originalGrade.suggestedScore === 0) || (originalGrade.assessment === 'needs_review' && originalGrade.suggestedScore === null), 'wrong selected option must be marked incorrect or conservatively sent for review');
    modelAssessment = originalGrade.assessment;
    modelSuggestedScore = originalGrade.suggestedScore;
    for (const item of report.result.items) if (item.assessment !== 'needs_review') {
      const question = questions.find((candidate): boolean => candidate.number === item.number);
      assert.ok(question && [question.referenceAnswer, question.basis].some((source): boolean => source.includes(item.evidenceQuote)));
    }
    checked('real Spark response has all question IDs and source-anchored evidence');
    const correctedAnswer = 'B';
    const correctionCommand: ReportCommand = { action: 'correct', requestId: randomUUID(), expectedRevision: report.revision, consent: true, number: '1', answer: correctedAnswer };
    let correctionStarted: () => void = (): void => undefined;
    const correctionEntering = new Promise<void>((resolve): void => { correctionStarted = resolve; });
    const correctionRun = commandHomeworkGradingReport(ownerId, draftId, created.id, correctionCommand, undefined, db);
    await waitFor(async (): Promise<boolean> => {
      const row = await db.homeworkGradingReport.findUnique({ where: { id: created.id }, select: { corrections: true } });
      const entries = Array.isArray(row?.corrections) ? row.corrections : [];
      const found = entries.some((item): boolean => !!item && typeof item === 'object' && 'requestId' in item && item.requestId === correctionCommand.requestId && 'state' in item && item.state === 'RUNNING');
      if (found) correctionStarted();
      return found;
    });
    await correctionEntering;
    const replay = await commandHomeworkGradingReport(ownerId, draftId, created.id, correctionCommand, undefined, db);
    assert.equal(replay.corrections.find((item): boolean => item.requestId === correctionCommand.requestId)?.state, 'RUNNING'); checked('correction request-key replay is idempotent while model is running');
    const corrected = await correctionRun;
    const attempt = corrected.corrections.find((item): boolean => item.requestId === correctionCommand.requestId);
    assert.ok(attempt); assert.equal(attempt.beforeAnswer, questions[0]?.answer); assert.equal(attempt.correctedAnswer, correctedAnswer);
    correctionStatus = attempt.state;
    if (attempt.state === 'READY') {
      assert.ok(attempt.result);
      assert.ok((attempt.result.assessment === 'correct' && attempt.result.suggestedScore === 100) || (attempt.result.assessment === 'needs_review' && attempt.result.suggestedScore === null), 'corrected selected option must be marked correct or conservatively sent for review');
      correctionAssessment = attempt.result.assessment;
      correctionSuggestedScore = attempt.result.suggestedScore;
      semanticSamplePassed = originalGrade.assessment === 'incorrect' && attempt.result.assessment === 'correct';
      checked('real correction preserves before/after answers and separate recheck status');
    } else {
      correctionCode = attempt.errorCode;
    }
    assert.deepEqual(await runHomeworkGradingReport(ownerId, draftId, created.id, undefined, db), corrected); checked('completed report replay does not invoke another model request');
  } else {
    modelCode = report.errorCode;
    checked('real model attempt returned a fixed failure state without partial results');
  }

  const mistakeInput: ReportCreateInput = { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: ['2'] };
  const mistakeReport = await createHomeworkGradingReport(ownerId, draftId, mistakeInput, db);
  await db.homeworkGradingReport.update({ where: { id: mistakeReport.id }, data: { state: 'READY', result: { items: [{ number: '2', assessment: 'incorrect', suggestedScore: 0, errorCause: 'concept', reason: '答案未满足唯一对应的条件。', evidenceQuote: '每一个自变量唯一对应一个函数值。', nextStep: '先找出“唯一对应”的含义。', objectiveMatch: 'unavailable', objectiveScore: null }] } } });
  const mistakes = await listHomeworkMistakes(ownerId, db);
  assert.ok(mistakes.items.some((item): boolean => item.reportId === mistakeReport.id && item.number === '2'));
  assert.equal((await listHomeworkMistakes(peerId, db)).items.length, 0); checked('mistake list uses a distinct AI source and remains owner-scoped');

  const oversizedQuestions: HomeworkQuestion[] = ['1', '2'].map((number): HomeworkQuestion => ({ number, type: 'short', prompt: '题'.repeat(4_000), answer: '答'.repeat(2_000), referenceAnswer: '参'.repeat(2_000), basis: '据'.repeat(4_000), reviewed: true }));
  const longDraftId = randomUUID();
  await db.homeworkDraft.create({ data: { id: longDraftId, ownerId, title: '超限合成输入', createDigest: hash('oversized-synthetic'), source: { kind: 'text', label: 'synthetic' }, state: 'CONFIRMED', revision: 1, questions: oversizedQuestions as unknown as Prisma.InputJsonValue } });
  await denied('aggregate report input over 16,000 characters is rejected', () => createHomeworkGradingReport(ownerId, longDraftId, { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: ['1', '2'] }, db), 'VALIDATION_FAILED');

  const beforeArchive = await createHomeworkGradingReport(ownerId, draftId, { requestId: randomUUID(), expectedDraftRevision: 1, consent: true, questionNumbers: ['1'] }, db);
  await db.homeworkDraft.update({ where: { id: draftId }, data: { state: 'ARCHIVED', revision: { increment: 1 } } });
  await denied('archived draft cannot start a pending analysis', () => runHomeworkGradingReport(ownerId, draftId, beforeArchive.id, undefined, db), 'CLASSROOM_CONFLICT');
  await denied('archived draft cannot accept a new correction', () => commandHomeworkGradingReport(ownerId, draftId, created.id, { action: 'correct', requestId: randomUUID(), expectedRevision: correctedReportRevision(report.revision, correctionStatus, created.id, db), consent: true, number: '2', answer: '另一条合成订正答案。' }, undefined, db), 'CLASSROOM_CONFLICT');

  const protectedAfter = await snapshot(db);
  const protectedNames = new Set(['AssignmentReview', 'Mastery', 'ExerciseRecord', 'SubmissionVersion', 'ClassAssignment']);
  assert.deepEqual(protectedAfter.filter((item): boolean => protectedNames.has(item.name)), protectedBefore.filter((item): boolean => protectedNames.has(item.name)));
  const draft = await db.homeworkDraft.findUniqueOrThrow({ where: { id: draftId } });
  assert.deepEqual(draft.questions, questions); assert.equal(draft.revision, 2); checked('official grades, existing exercises, class submissions, and confirmed question content are untouched');
  return { modelStatus, modelCode, modelMs, modelAssessment, modelSuggestedScore, correctionStatus, correctionCode, correctionAssessment, correctionSuggestedScore, semanticSamplePassed };
}

function correctedReportRevision(initial: number, correctionState: string | null, _draftId: string, _db: PrismaClient): number {
  // The UI sends the report's post-correction revision; the isolated test only needs
  // to reach the archive guard, which runs before revision validation.
  return initial + (correctionState ? 2 : 0);
}

async function main(): Promise<void> {
  const mainUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(mainUrl.hostname), 'acceptance requires the local PostgreSQL database');
  const name = `slp_hw_grade_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(mainUrl); adminUrl.pathname = '/postgres';
  const testUrl = new URL(mainUrl); testUrl.pathname = `/${name}`;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  const local = new PrismaClient();
  const before = await snapshot(local), envBefore = envDigest();
  let db: PrismaClient | undefined, created = false, model = { modelStatus: 'NOT_RUN', modelCode: null as string | null, modelMs: null as number | null, modelAssessment: null as string | null, modelSuggestedScore: null as number | null, correctionStatus: null as string | null, correctionCode: null as string | null, correctionAssessment: null as string | null, correctionSuggestedScore: null as number | null, semanticSamplePassed: false };
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
    migrate(testUrl.toString()); db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
    model = await exercise(db);
    const after = await snapshot(local);
    assert.deepEqual(after.filter((row): boolean => before.some((prior): boolean => prior.name === row.name)), before);
    assert.deepEqual(envDigest(), envBefore); checked('temporary database dropped without changing the existing local database or env');
    const realModelContractPassed = model.modelStatus === 'READY' && model.correctionStatus === 'READY';
    const state = !realModelContractPassed ? 'BLOCKED_REAL_MODEL' : model.semanticSamplePassed ? 'PASSED' : 'NEEDS_SEMANTIC_REVIEW';
    writeFileSync(`${root}/report.json`, JSON.stringify({ state, date: new Date().toISOString(), checks, count: checks.length, model: process.env.SPARK_MODEL ?? 'configured-default', realModelContractPassed, semanticSamplePassed: model.semanticSamplePassed, initialAssessment: model.modelAssessment, initialSuggestedScore: model.modelSuggestedScore, correctionStatus: model.correctionStatus, correctionCode: model.correctionCode, correctionAssessment: model.correctionAssessment, correctionSuggestedScore: model.correctionSuggestedScore, modelStatus: model.modelStatus, modelCode: model.modelCode, modelMs: model.modelMs, isolatedDatabase: true, localMigrationApplied: false, configUnchanged: true, protectedTablesUnchanged: true, realInputWasSynthetic: true, noUserHomeworkSent: true }, null, 2));
  } finally {
    await db?.$disconnect(); await local.$disconnect();
    if (created) { assert.match(name, /^slp_hw_grade_[a-f0-9]{32}$/u); assert.notEqual(`/${name}`, mainUrl.pathname); await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); }
    await admin.$disconnect(); getRedis().disconnect();
  }
  console.log(JSON.stringify({ checks: checks.length, isolatedDatabaseCleaned: true, realModelContractPassed: model.modelStatus === 'READY' && model.correctionStatus === 'READY', semanticSamplePassed: model.semanticSamplePassed, initialAssessment: model.modelAssessment, correctionAssessment: model.correctionAssessment, modelStatus: model.modelStatus, correctionStatus: model.correctionStatus, evidence: `${root}/report.json` }));
  if (model.modelStatus !== 'READY' || model.correctionStatus !== 'READY' || !model.semanticSamplePassed) process.exitCode = 1;
}

main().catch((error: unknown): void => {
  writeFileSync(`${root}/failure.json`, JSON.stringify({ state: 'FAILED', type: error instanceof Error ? error.name : 'unknown', code: safeCode(error), checks, detail: error instanceof assert.AssertionError ? error.message : undefined }, null, 2));
  console.error(`Homework grading isolated acceptance failed; inspect ${root}/failure.json (redacted).`); process.exitCode = 1;
});
