import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

import { createClass, joinClass, commandClass, listClasses, readClass, classSources } from '../../src/lib/classrooms/service';
import { classHandlers } from '../../src/lib/classrooms/routes';
import { signAccessToken } from '../../src/lib/auth/jwt';
import { NextRequest } from 'next/server';
import { getRedis } from '../../src/lib/redis';
import type { ClassCommand, ClassResult } from '../../src/lib/classrooms/contracts';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const root = '.taskbook-working/classroom-workflow-20261019';
mkdirSync(root, { recursive: true });
writeFileSync(`${root}/report.json`, JSON.stringify({ state: 'RUNNING', date: new Date().toISOString() }));
const newTables = ['Classroom', 'ClassMember', 'ClassInvite', 'ClassChapter', 'ClassAssignment', 'AssignmentSubmission', 'SubmissionVersion', 'AssignmentReview', 'AssignmentAttachment', 'ClassroomOperation'];
const checks: string[] = [];
let stage = 'initialization';
function checked(name: string): void { checks.push(name); stage = name; }
async function denied(name: string, action: () => Promise<unknown>, code = 'NOT_FOUND'): Promise<void> {
  stage = name; await assert.rejects(action, (reason: unknown) => typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === code); checked(name);
}
function migrate(url: string): void {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  // Prisma stdout may name the datasource; do not publish raw process output.
  assert.equal(result.status, 0, 'Migration subprocess failed');
}
type TableDigest = { name: string; count: string; digest: string };
async function snapshot(db: PrismaClient, names?: string[]): Promise<TableDigest[]> {
  const tables = names ?? (await db.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((row) => row.name);
  const result: TableDigest[] = [];
  for (const name of tables) {
    assert.match(name, /^[A-Za-z][A-Za-z0-9_]*$/u);
    const rows = await db.$queryRawUnsafe<Array<{ count: string; digest: string }>>(`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM "${name}" t`);
    result.push({ name, ...rows[0] });
  }
  return result;
}
function envDigest(): string[] { return ['.env', '.env.local'].map((file) => createHash('sha256').update(readFileSync(file)).digest('hex')); }

async function exercise(db: PrismaClient): Promise<void> {
  for (const [id, role] of [['owner', 'teacher'], ['other', 'teacher'], ['legacy-admin', 'admin'], ['s1', 'student'], ['s2', 'student'], ['s3', 'student'], ['outside', 'student']]) await db.user.create({ data: { id, role, nickname: id, email: `${id}@classroom.invalid`, passwordHash: 'isolated-fixture-not-for-login' } });
  const legacy = await db.classroom.create({ data: { responsibleId: 'legacy-admin', title: '历史管理员班级', description: '' } });
  assert.equal((await readClass('legacy-admin', legacy.id, db)).canManage, true);
  assert.equal((await listClasses('legacy-admin', 1, db)).canCreate, false);
  await denied('legacy admin cannot create another classroom', () => createClass('legacy-admin', { requestId: randomUUID(), title: '禁止新建', description: '' }, db));
  await denied('teacher cannot read legacy admin classroom', () => readClass('owner', legacy.id, db));
  checked('legacy admin retains only original classroom ownership');
  const create = { requestId: randomUUID(), title: '原创测试班', description: '按章节学习' };
  const room = await createClass('owner', create, db), cid = room.classroomId;
  assert.equal((await createClass('owner', create, db)).replayed, true); checked('create idempotency');
  await denied('create request cannot change payload', () => createClass('owner', { ...create, title: '覆盖' }, db), 'CLASSROOM_CONFLICT');
  await denied('student cannot create', () => createClass('s1', { ...create, requestId: randomUUID() }, db));
  assert.equal((await listClasses('other', 1, db)).items.length, 0); checked('other admin lists own classes only');
  await denied('other admin cannot read', () => readClass('other', cid, db));
  await denied('outsider cannot read', () => readClass('outside', cid, db));
  await denied('unjoined student cannot list sources', () => classSources('s1', cid, 1, db));
  const rev = async (): Promise<number> => (await readClass('owner', cid, db)).classroom.revision;
  const command = async (input: Omit<ClassCommand, 'requestId' | 'expectedRevision'> | Record<string, unknown>): Promise<ClassResult> => commandClass('owner', cid, { requestId: randomUUID(), expectedRevision: await rev(), ...input }, db);
  const inviteInput = { requestId: randomUUID(), expectedRevision: await rev(), action: 'invite', days: 7, maxUses: 1, confirmed: true };
  const invite = await commandClass('owner', cid, inviteInput, db); assert.match(invite.code ?? '', /^[A-Za-z0-9_-]{22}$/u); checked('first invite displays raw code');
  assert.equal((await commandClass('owner', cid, inviteInput, db)).code, undefined); checked('invite replay never redisplays raw code');
  const serializedOwner = JSON.stringify(await readClass('owner', cid, db)); assert.ok(!serializedOwner.includes(invite.code ?? 'MISSING')); assert.ok(!serializedOwner.includes('codeHash')); checked('owner DTO excludes raw invite and digest');
  const joins = await Promise.allSettled(['s1', 's2'].map((actor) => joinClass(actor, { requestId: randomUUID(), code: invite.code, confirmed: true }, db)));
  assert.equal(joins.filter((r) => r.status === 'fulfilled').length, 1); assert.equal((await db.classInvite.findUniqueOrThrow({ where: { id: invite.resultId } })).usedCount, 1); checked('concurrent last invite slot accepts exactly one');
  const memberId = joins[0].status === 'fulfilled' ? 's1' : 's2', otherId = memberId === 's1' ? 's2' : 's1';
  const invite2 = await command({ action: 'invite', days: 1, maxUses: 10, confirmed: true });
  await denied('rotated code rejected', () => joinClass('s3', { requestId: randomUUID(), code: invite.code, confirmed: true }, db), 'VALIDATION_FAILED');
  const joinInput = { requestId: randomUUID(), code: invite2.code, confirmed: true };
  await joinClass(otherId, joinInput, db); await joinClass(otherId, joinInput, db); checked('join retry idempotent');
  const uses = (await db.classInvite.findUniqueOrThrow({ where: { id: invite2.resultId } })).usedCount;
  await joinClass(otherId, { ...joinInput, requestId: randomUUID() }, db); assert.equal((await db.classInvite.findUniqueOrThrow({ where: { id: invite2.resultId } })).usedCount, uses); checked('existing active member does not consume quota again');
  const chapterInput = { action: 'chapter', title: '第一章', body: '章节真实内容', sequence: 0, state: 'DRAFT', sharedCourseId: null, publishConfirmed: false };
  const chapter = await command(chapterInput); assert.equal((await readClass(memberId, cid, db)).chapters.length, 0); checked('draft chapter absent from student DTO');
  const taskInput = { action: 'assignment', title: '学习任务', instructions: '说明自己的推理步骤', chapterId: chapter.resultId, state: 'DRAFT', dueAt: null, publishConfirmed: false };
  const task = await command(taskInput); assert.equal((await readClass(memberId, cid, db)).assignments.length, 0); checked('draft task absent from student DTO');
  await denied('publish chapter requires confirmation', () => command({ ...chapterInput, id: chapter.resultId, entityRevision: 1, state: 'PUBLISHED' }), 'VALIDATION_FAILED');
  const dueAt = new Date(Date.now() + 3600000).toISOString();
  await denied('publish task requires deadline', () => command({ ...taskInput, id: task.resultId, entityRevision: 1, state: 'PUBLISHED', publishConfirmed: true }), 'VALIDATION_FAILED');
  await denied('past deadline rejected', () => command({ ...taskInput, id: task.resultId, entityRevision: 1, state: 'PUBLISHED', dueAt: new Date(0).toISOString(), publishConfirmed: true }), 'VALIDATION_FAILED');
  await command({ ...taskInput, id: task.resultId, entityRevision: 1, state: 'PUBLISHED', dueAt, publishConfirmed: true });
  assert.equal((await readClass(memberId, cid, db)).assignments.length, 0); checked('published task in draft chapter remains hidden');
  const publishedInput = { ...chapterInput, requestId: randomUUID(), expectedRevision: await rev(), id: chapter.resultId, entityRevision: 1, state: 'PUBLISHED', publishConfirmed: true };
  await commandClass('owner', cid, publishedInput, db); assert.equal((await commandClass('owner', cid, publishedInput, db)).replayed, true); checked('chapter publish retry before revision check');
  let student = await readClass(memberId, cid, db); assert.equal(student.chapters.length, 1); assert.equal(student.assignments.length, 1); assert.deepEqual(student.members, []); assert.deepEqual(student.invites, []); checked('student sees published content without peer/invite data');
  await denied('stale class version rejected', () => commandClass('owner', cid, { requestId: randomUUID(), expectedRevision: 1, action: 'class', title: '冲突', description: '' }, db), 'CLASSROOM_CONFLICT');
  await denied('stale entity version rejected', () => command({ ...chapterInput, id: chapter.resultId, entityRevision: 1, publishConfirmed: true }), 'CLASSROOM_CONFLICT');
  await denied('published edit requires confirmation', () => command({ ...chapterInput, id: chapter.resultId, entityRevision: 2 }), 'VALIDATION_FAILED');
  await denied('student cannot mutate class', async () => commandClass(memberId, cid, { action: 'class', requestId: randomUUID(), expectedRevision: await rev(), title: '越权', description: '' }, db));
  await denied('other administrator cannot mutate class', async () => commandClass('other', cid, { action: 'archive', requestId: randomUUID(), expectedRevision: await rev(), state: 'ARCHIVED', confirmed: true }, db));
  const otherRoom = await createClass('other', { ...create, requestId: randomUUID() }, db);
  const otherChapter = await commandClass('other', otherRoom.classroomId, { ...chapterInput, requestId: randomUUID(), expectedRevision: 1 }, db);
  await denied('cross class chapter edit denied', () => command({ ...chapterInput, id: otherChapter.resultId, entityRevision: 1 }), 'NOT_FOUND');
  await denied('cross class task parent denied', () => command({ ...taskInput, chapterId: otherChapter.resultId }), 'NOT_FOUND');
  await denied('private source identifier cannot bind', () => command({ ...chapterInput, sequence: 10, sharedCourseId: 'private-content' }), 'VALIDATION_FAILED');
  await db.sharedCourse.create({ data: { id: 'shared', publisherId: 'owner', title: '原创授权课程', description: '', contentType: 'DOCUMENT', format: 'TXT', fileSizeBytes: 10, mediaKey: 'fixture-no-object', snapshot: {}, include: {}, rightsStatement: '本人原创授权', rightsConfirmed: true, preparedAt: new Date(), state: 'PUBLISHED', requestId: randomUUID(), requestDigest: 'fixture' } });
  assert.equal((await classSources('owner', cid, 1, db)).items[0].id, 'shared'); checked('source candidates restricted to published authorized course');
  const linked = await command({ ...chapterInput, sequence: 2, state: 'PUBLISHED', sharedCourseId: 'shared', publishConfirmed: true });
  assert.equal((await readClass(memberId, cid, db)).chapters.find((c) => c.id === linked.resultId)?.sharedCourseId, 'shared'); checked('published shared source available');
  await db.sharedCourse.update({ where: { id: 'shared' }, data: { state: 'WITHDRAWN' } });
  assert.equal((await readClass(memberId, cid, db)).chapters.find((c) => c.id === linked.resultId)?.sharedCourseId, null); assert.equal((await classSources('owner', cid, 1, db)).items.length, 0); checked('withdrawn source removes link and candidate');
  await command({ ...chapterInput, id: chapter.resultId, entityRevision: 2, state: 'WITHDRAWN', publishConfirmed: true });
  student = await readClass(memberId, cid, db); assert.ok(!student.chapters.some((c) => c.id === chapter.resultId)); assert.equal(student.assignments.length, 0); checked('chapter withdrawal also hides linked task');
  const member = (await readClass('owner', cid, db)).members.find((m) => m.studentId === otherId)!;
  await command({ action: 'member', studentId: otherId, state: 'REMOVED', memberRevision: member.revision, confirmed: true });
  await denied('removed member loses class read', () => readClass(otherId, cid, db));
  await denied('old join replay cannot restore removed member', () => joinClass(otherId, joinInput, db));
  await denied('new invite cannot restore removed member', () => joinClass(otherId, { ...joinInput, requestId: randomUUID() }, db), 'VALIDATION_FAILED');
  await command({ action: 'member', studentId: otherId, state: 'ACTIVE', memberRevision: member.revision + 1, confirmed: true }); assert.equal((await readClass(otherId, cid, db)).canManage, false); checked('owner explicitly restores removed student');
  await commandClass(otherId, cid, { requestId: randomUUID(), expectedRevision: await rev(), action: 'leave', confirmed: true }, db); await denied('left member loses access', () => readClass(otherId, cid, db));
  await joinClass(otherId, { ...joinInput, requestId: randomUUID() }, db); checked('left member can explicitly join again');
  await command({ action: 'archive', state: 'ARCHIVED', confirmed: true }); assert.equal((await readClass(memberId, cid, db)).classroom.state, 'ARCHIVED'); checked('archived published content readable');
  await denied('archive rejects new chapters', () => command(chapterInput), 'CLASSROOM_CONFLICT');
  await denied('archive rejects joins', () => joinClass('s3', { ...joinInput, requestId: randomUUID() }, db), 'VALIDATION_FAILED');
  await command({ action: 'archive', state: 'ACTIVE', confirmed: true });
  await denied('restoring class does not revive old invite', () => joinClass('s3', { ...joinInput, requestId: randomUUID() }, db), 'VALIDATION_FAILED');
  await db.user.update({ where: { id: 'owner' }, data: { role: 'student' } }); await denied('revoked manager role loses write', () => command({ action: 'class', title: '越权', description: '' })); await db.user.update({ where: { id: 'owner' }, data: { role: 'teacher' } });
  await denied('duplicate chapter sequence rejected safely', () => command({ ...chapterInput, sequence: 2 }), 'CLASSROOM_CONFLICT');
  const stateBefore = await rev();
  const racers = await Promise.allSettled(['一', '二'].map((suffix) => commandClass('owner', cid, { requestId: randomUUID(), expectedRevision: stateBefore, action: 'class', title: '并发班名' + suffix, description: '' }, db)));
  assert.equal(racers.filter((r) => r.status === 'fulfilled').length, 1); checked('same class version has one concurrent management winner');
  const expiring = await command({ action: 'invite', days: 1, maxUses: 1, confirmed: true });
  await db.classInvite.update({ where: { id: expiring.resultId }, data: { createdAt: new Date(Date.now() - 172800000), expiresAt: new Date(Date.now() - 86400000) } });
  await denied('real expired invite rejected', () => joinClass('s3', { requestId: randomUUID(), code: expiring.code, confirmed: true }, db), 'VALIDATION_FAILED');
  const revoked = await command({ action: 'invite', days: 1, maxUses: 1, confirmed: true });
  await command({ action: 'revoke', inviteId: revoked.resultId });
  await denied('explicitly revoked invite rejected', () => joinClass('s3', { requestId: randomUUID(), code: revoked.code, confirmed: true }, db), 'VALIDATION_FAILED');
  await db.user.update({ where: { id: memberId }, data: { role: 'admin' } });
  await denied('student role changed to unrelated administrator loses class', () => readClass(memberId, cid, db));
  await db.user.update({ where: { id: memberId }, data: { role: 'student' } });
  const closed = await command({ ...taskInput, chapterId: null, state: 'CLOSED', dueAt: new Date(0).toISOString(), publishConfirmed: true });
  assert.equal((await readClass(memberId, cid, db)).assignments.find((t) => t.id === closed.resultId)?.state, 'CLOSED'); checked('closed standalone task remains readable without implying submission');
  const mine2 = await createClass('owner', { ...create, requestId: randomUUID() }, db);
  await denied('operation key cannot be replayed in another owned class', () => commandClass('owner', mine2.classroomId, { ...inviteInput, expectedRevision: 1 }, db), 'CLASSROOM_CONFLICT');
  const operations = await db.classroomOperation.findMany(); assert.ok(operations.every((o) => /^[a-f0-9]{64}$/u.test(o.inputDigest))); assert.ok(!JSON.stringify(operations).includes(invite2.code ?? 'MISSING')); checked('operation journal stores full digests without raw codes');
  const handlers = classHandlers(db), token = signAccessToken({ sub: memberId, email: null, role: 'admin' });
  const req = (path: string, method = 'GET', body?: unknown): NextRequest => new NextRequest('http://local/api/classes' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-real-ip': '192.0.2.155' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response = await handlers.READ(req('/' + cid), { params: Promise.resolve({ id: cid }) }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); checked('real authenticated route resolves async params with private headers');
  response = await handlers.COMMAND(req('/' + cid, 'POST', { action: 'class', requestId: randomUUID(), expectedRevision: await rev(), title: '伪造管理员', description: '' }), { params: { id: cid } }); assert.equal(response.status, 404); checked('forged stale JWT role gives no manager bypass');
  response = await handlers.GET(req('?page=1&page=2')); assert.equal(response.status, 400); checked('real list route rejects duplicate query');
  for (let i = 0; i < 6; i++) response = await handlers.JOIN(req('/join', 'POST', { invalid: true })); assert.equal(response.status, 429); checked('invalid join attempts count toward five per minute limit');
  assert.equal(await db.assignmentSubmission.count(), 0); assert.equal(await db.assignmentReview.count(), 0); checked('no premature submission or grading writes');
}
async function main(): Promise<void> {
  const mainUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(mainUrl.hostname), 'Local PostgreSQL only');
  const name = `slp_class_workflow_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^slp_class_workflow_[a-f0-9]{32}$/u);
  const isolatedUrl = new URL(mainUrl); isolatedUrl.pathname = `/${name}`;
  assert.notEqual(isolatedUrl.pathname, mainUrl.pathname);
  const adminUrl = new URL(mainUrl); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } }), local = new PrismaClient({ datasources: { db: { url: mainUrl.toString() } } });
  let isolated: PrismaClient | undefined, created = false;
  try {
    stage = 'snapshot existing local data'; const originalTables = (await snapshot(local)); const config = envDigest();
    stage = 'create isolated database'; await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
    stage = 'deploy isolated migrations'; migrate(isolatedUrl.toString());
    isolated = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    await exercise(isolated);
    const apply = process.argv.includes('--apply-local');
    if (apply) { stage = 'deploy local additive migration'; migrate(mainUrl.toString()); checked('local additive migration deployed'); }
    assert.deepEqual(await snapshot(local, originalTables.map((table) => table.name)), originalTables); checked('all original business table digests preserved');
    assert.deepEqual(envDigest(), config); checked('environment files unchanged');
    if (apply) { const added = await snapshot(local, newTables); assert.ok(added.every((table) => table.count === '0')); checked('ten new local tables are empty'); }
    writeFileSync(`${root}/report.json`, JSON.stringify({ state: 'PASSED', date: new Date().toISOString(), checks, count: checks.length, originalTables: originalTables.length, isolatedDatabase: true, localMigrationApplied: apply, configUnchanged: true, originalDataUnchanged: true, realModelCalled: false, httpWriteWorkflowsImplemented: true }, null, 2));
  } finally {
    await isolated?.$disconnect(); await local.$disconnect();
    if (created) {
      assert.match(name, /^slp_class_workflow_[a-f0-9]{32}$/u); assert.notEqual(`/${name}`, mainUrl.pathname);
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.$disconnect(); getRedis().disconnect();
  }
  checked('isolated test database cleaned');
  const report = JSON.parse(readFileSync(`${root}/report.json`, 'utf8')) as Record<string, unknown>;
  writeFileSync(`${root}/report.json`, JSON.stringify({ ...report, checks, count: checks.length, isolatedDatabaseCleaned: true }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, isolatedDatabaseCleaned: true, localMigrationApplied: process.argv.includes('--apply-local') }));
}
main().catch((reason: unknown): void => {
  const failure = { state: 'FAILED', failedAt: stage, type: reason instanceof Error ? reason.name : 'unknown', checks };
  writeFileSync(`${root}/report.json`, JSON.stringify(failure, null, 2)); console.error(JSON.stringify({ failedAt: failure.failedAt, type: failure.type })); process.exitCode = 1;
});




