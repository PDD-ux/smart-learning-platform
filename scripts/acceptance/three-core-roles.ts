/** §29.11: one isolated teacher/two-student classroom-to-private-grading chain. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';

import { createClass, commandClass, joinClass, readClass } from '../../src/lib/classrooms/service';
import { assignmentCommand, assignmentView, readSubmission, reviewSubmission } from '../../src/lib/classrooms/assignments';
import { createHomework, commandHomework, readHomework } from '../../src/lib/homework/service';
import { createHomeworkGradingReport, runHomeworkGradingReport, commandHomeworkGradingReport, listHomeworkMistakes } from '../../src/lib/homework/grading-service';
import { getRedis } from '../../src/lib/redis';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const directory = '.taskbook-working/phase29-11';
mkdirSync(directory, { recursive: true });
const reportPath = `${directory}/three-core-roles.json`;
const checks: string[] = [];
let stage = 'preflight';
function checked(name: string): void { stage = name; checks.push(name); }
function envDigest(): string[] { return ['.env', '.env.local'].map((file): string => createHash('sha256').update(readFileSync(file)).digest('hex')); }
function migrate(url: string): void {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  assert.equal(result.status, 0, 'Isolated migration failed');
}
async function snapshot(db: PrismaClient): Promise<Array<{ name: string; count: string; digest: string }>> {
  const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`;
  const result: Array<{ name: string; count: string; digest: string }> = [];
  for (const { name } of tables) {
    assert.match(name, /^[A-Za-z][A-Za-z0-9_]*$/u);
    const [row] = await db.$queryRawUnsafe<Array<{ count: string; digest: string }>>(`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "${name}" t`);
    result.push({ name, ...row });
  }
  return result;
}
async function denied(name: string, work: () => Promise<unknown>): Promise<void> {
  await assert.rejects(work);
  checked(name);
}

async function exercise(db: PrismaClient): Promise<Record<string, unknown>> {
  const [teacher, studentA, studentB, outsider] = Array.from({ length: 4 }, (): string => randomUUID());
  for (const [id, role, nickname] of [[teacher, 'teacher', '原创课负责人'], [studentA, 'student', '甲同学'], [studentB, 'student', '乙同学'], [outsider, 'student', '班外同学']] as const) {
    await db.user.create({ data: { id, role, nickname, email: `${id}@three-core.invalid`, passwordHash: 'isolated-fixture-no-login' } });
  }
  const room = await createClass(teacher, { requestId: randomUUID(), title: '原创演示课·函数概念', description: '供毕设三角色隔离验收' }, db);
  const rev = async (): Promise<number> => (await readClass(teacher, room.classroomId, db)).classroom.revision;
  const command = async (input: Record<string, unknown>): Promise<{ resultId: string; code?: string }> => commandClass(teacher, room.classroomId, { requestId: randomUUID(), expectedRevision: await rev(), ...input }, db);
  const invite = await command({ action: 'invite', days: 1, maxUses: 2, confirmed: true });
  assert.ok(invite.code);
  for (const student of [studentA, studentB]) await joinClass(student, { requestId: randomUUID(), code: invite.code, confirmed: true }, db);
  assert.equal((await readClass(teacher, room.classroomId, db)).members.length, 2);
  await denied('outsider cannot read classroom', () => readClass(outsider, room.classroomId, db));
  checked('teacher created classroom and two students joined via one invite');

  const chapterBase = { action: 'chapter', title: '第一章 函数的概念', body: '每个输入都有且只有一个输出。', sequence: 0, sharedCourseId: null };
  const chapter = await command({ ...chapterBase, state: 'DRAFT', publishConfirmed: false });
  await command({ ...chapterBase, id: chapter.resultId, entityRevision: 1, state: 'PUBLISHED', publishConfirmed: true });
  const taskBase = { action: 'assignment', title: '函数定义与反例', instructions: '说明唯一对应，举一个反例。', chapterId: chapter.resultId };
  const task = await command({ ...taskBase, state: 'DRAFT', dueAt: null, publishConfirmed: false });
  await command({ ...taskBase, id: task.resultId, entityRevision: 1, state: 'PUBLISHED', dueAt: new Date(Date.now() + 3_600_000).toISOString(), publishConfirmed: true });
  assert.equal((await readClass(studentA, room.classroomId, db)).assignments.length, 1);
  checked('chapter and deadline-bound task published to both students');

  const bodyA = '函数要求每个输入唯一对应一个输出。反例：输入1同时对应2和3。';
  const bodyB = '函数就是每个输入唯一对应一个输出；输入1对应2、输入2对应4。';
  const draftA = await assignmentCommand(studentA, task.resultId, { action: 'draft', requestId: randomUUID(), expectedRevision: 0, bodyText: bodyA }, db);
  const draftB = await assignmentCommand(studentB, task.resultId, { action: 'draft', requestId: randomUUID(), expectedRevision: 0, bodyText: bodyB }, db);
  assert.equal((await assignmentView(teacher, task.resultId, 1, db)).board?.submittedStudents, 0);
  checked('two private drafts do not count as submitted');
  const submit = async (actor: string, submissionId: string): Promise<string> => {
    const row = await db.assignmentSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    const assignment = await db.classAssignment.findUniqueOrThrow({ where: { id: task.resultId } });
    const result = await assignmentCommand(actor, task.resultId, { action: 'submit', requestId: randomUUID(), expectedRevision: row.revision, assignmentRevision: assignment.revision, attachmentIds: [], confirmed: true }, db);
    return result.resultId;
  };
  const versionA1 = await submit(studentA, draftA.submissionId);
  const versionB1 = await submit(studentB, draftB.submissionId);
  assert.equal((await assignmentView(teacher, task.resultId, 1, db)).board?.submittedStudents, 2);
  await denied('peer cannot read the other submitted work', () => readSubmission(studentB, draftA.submissionId, db));
  checked('two formal submissions appear in the real classroom board and stay peer-private');

  const returned = await readSubmission(teacher, draftA.submissionId, db);
  await reviewSubmission(teacher, draftA.submissionId, { action: 'review', requestId: randomUUID(), expectedRevision: returned.revision, versionId: versionA1, state: 'RETURNED', score: null, feedback: '请补充判断步骤后重新提交。', confirmed: true }, db);
  assert.equal((await assignmentView(teacher, task.resultId, 1, db)).board?.returned, 1);
  const returnedRow = await db.assignmentSubmission.findUniqueOrThrow({ where: { id: draftA.submissionId } });
  await assignmentCommand(studentA, task.resultId, { action: 'draft', requestId: randomUUID(), expectedRevision: returnedRow.revision, bodyText: `${bodyA} 先确定定义域，再检查每个输入的输出是否唯一。` }, db);
  const versionA2 = await submit(studentA, draftA.submissionId);
  for (const [submissionId, versionId, score] of [[draftA.submissionId, versionA2, 88], [draftB.submissionId, versionB1, 92]] as const) {
    const detail = await readSubmission(teacher, submissionId, db);
    await reviewSubmission(teacher, submissionId, { action: 'review', requestId: randomUUID(), expectedRevision: detail.revision, versionId, state: 'GRADED', score, feedback: '已核对函数定义与例子。', confirmed: true }, db);
  }
  const board = (await assignmentView(teacher, task.resultId, 1, db)).board;
  assert.equal(board?.submittedStudents, 2);
  assert.equal(board?.graded, 2);
  assert.equal((await readSubmission(studentA, draftA.submissionId, db)).versions.length, 2);
  checked('teacher returned A, A resubmitted, and both received immutable formal feedback');

  const draft = await createHomework(studentA, { id: randomUUID(), title: '本人订正·函数定义', source: { kind: 'submission', versionId: versionA2 } }, db);
  assert.equal(draft.source.kind, 'submission');
  assert.equal(draft.rawText.includes('先确定定义域'), true);
  await denied('peer cannot open A private correction draft', () => readHomework(studentB, draft.id, db));
  const saved = await commandHomework(studentA, draft.id, { action: 'save', requestId: randomUUID(), expectedRevision: draft.revision, questions: [{ number: '1', type: 'choice', prompt: '函数定义中哪项正确？A一个输入对应多个输出，B每个输入唯一对应一个输出。', answer: 'A', referenceAnswer: 'B', basis: 'B：每个输入唯一对应一个输出。', reviewed: true }] }, db);
  const frozen = await commandHomework(studentA, draft.id, { action: 'confirm', requestId: randomUUID(), expectedRevision: saved.revision, confirmed: true }, db);
  const report = await createHomeworkGradingReport(studentA, draft.id, { requestId: randomUUID(), expectedDraftRevision: frozen.revision, consent: true, questionNumbers: ['1'] }, db);
  await denied('peer cannot start A private AI report', () => runHomeworkGradingReport(studentB, draft.id, report.id, undefined, db));
  const first = await runHomeworkGradingReport(studentA, draft.id, report.id, undefined, db);
  const modelStatus = first.state;
  let correctionStatus: string | null = null;
  let initialAssessment: string | null = null;
  let correctionAssessment: string | null = null;
  let semanticSamplePassed = false;
  if (first.state === 'READY') {
    const item = first.result?.items.find((candidate): boolean => candidate.number === '1');
    assert.ok(item);
    assert.equal(item.objectiveMatch, 'mismatch');
    assert.equal(item.objectiveScore, 0);
    assert.ok(item.assessment === 'incorrect' || item.assessment === 'needs_review');
    initialAssessment = item.assessment;
    const correction = await commandHomeworkGradingReport(studentA, draft.id, report.id, { action: 'correct', requestId: randomUUID(), expectedRevision: first.revision, consent: true, number: '1', answer: 'B' }, undefined, db);
    const attempt = correction.corrections.at(-1);
    correctionStatus = attempt?.state ?? null;
    if (attempt?.state === 'READY') {
      const checkedResult = attempt.result;
      assert.ok(checkedResult);
      assert.equal(attempt.beforeAnswer, 'A');
      assert.equal(attempt.correctedAnswer, 'B');
      assert.equal(checkedResult.objectiveMatch, 'match');
      assert.equal(checkedResult.objectiveScore, 100);
      assert.ok(checkedResult.assessment === 'correct' || checkedResult.assessment === 'needs_review');
      correctionAssessment = checkedResult.assessment;
      semanticSamplePassed = initialAssessment === 'incorrect' && correctionAssessment === 'correct';
    }
  }
  const after = (await assignmentView(teacher, task.resultId, 1, db)).board;
  assert.equal(after?.graded, 2, 'Private AI advice must not change formal teacher grades');
  assert.equal((await db.assignmentReview.count({ where: { versionId: versionA2 } })), 1);
  assert.equal((await listHomeworkMistakes(studentB, db)).items.length, 0);
  checked('submission-sourced private report cannot alter official grade or leak to peer');
  return { checks, classMembers: 2, submittedStudents: 2, versionCountA: 2, formalGrades: [88, 92], privateSourceVersionMatches: draft.source.versionId === versionA2, modelStatus, modelCode: first.errorCode, correctionStatus, initialAssessment, correctionAssessment, semanticSamplePassed, modelQualityScope: 'one synthetic choice item only' };
}

async function main(): Promise<void> {
  const mainUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(mainUrl.hostname), 'Local PostgreSQL required');
  const dbName = `slp_threecore_${randomUUID().replaceAll('-', '')}`;
  assert.match(dbName, /^slp_threecore_[a-f0-9]{32}$/u);
  const adminUrl = new URL(mainUrl); adminUrl.pathname = '/postgres';
  const isolatedUrl = new URL(mainUrl); isolatedUrl.pathname = `/${dbName}`;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  const local = new PrismaClient({ datasources: { db: { url: mainUrl.toString() } } });
  let isolated: PrismaClient | undefined;
  let created = false;
  let result: Record<string, unknown> = {};
  const before = await snapshot(local), config = envDigest();
  try {
    stage = 'create isolated database';
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`); created = true;
    stage = 'migrate isolated database'; migrate(isolatedUrl.toString());
    isolated = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    result = await exercise(isolated);
    assert.deepEqual(await snapshot(local), before);
    assert.deepEqual(envDigest(), config);
    checked('all existing local tables and environment files unchanged');
  } finally {
    await isolated?.$disconnect(); await local.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.$disconnect(); getRedis().disconnect();
  }
  const complete = result.modelStatus === 'READY' && result.correctionStatus === 'READY';
  const state = !complete ? 'BLOCKED_REAL_MODEL' : result.semanticSamplePassed ? 'PASSED' : 'NEEDS_SEMANTIC_REVIEW';
  writeFileSync(reportPath, JSON.stringify({ state, date: new Date().toISOString(), ...result, isolatedDatabaseCleaned: true, localDataUnchanged: true, envUnchanged: true, nativePageTested: false }, null, 2));
  console.log(JSON.stringify({ state, checks: checks.length, isolatedDatabaseCleaned: true, modelStatus: result.modelStatus, correctionStatus: result.correctionStatus, initialAssessment: result.initialAssessment, correctionAssessment: result.correctionAssessment, reportPath }));
  if (!complete) process.exitCode = 1;
}

main().catch((error: unknown): void => {
  writeFileSync(reportPath, JSON.stringify({ state: 'FAILED', stage, type: error instanceof Error ? error.name : 'UnknownError', detail: error instanceof assert.AssertionError ? error.message : undefined, checks }, null, 2));
  console.error(JSON.stringify({ state: 'FAILED', stage, type: error instanceof Error ? error.name : 'UnknownError', reportPath }));
  process.exitCode = 1;
});
