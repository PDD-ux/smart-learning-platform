import { loadEnvConfig } from '@next/env';
import { Prisma, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { readClassroom, readClassChapter, readClassAssignment, readAssignmentSubmission, requireClassroomAccess, requireClassroomManager, authorizeAssignmentAttachment, authorizeAssignmentReview } from '../../src/lib/classrooms/access';
import { attachmentStorageKey, classRequestDigest, createInviteCode } from '../../src/lib/classrooms/rules';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const root = '.taskbook-working/classroom-foundation-20261019';
mkdirSync(root, { recursive: true });
writeFileSync(`${root}/report.json`, JSON.stringify({ state: 'RUNNING', date: new Date().toISOString() }));
const newTables = ['Classroom', 'ClassMember', 'ClassInvite', 'ClassChapter', 'ClassAssignment', 'AssignmentSubmission', 'SubmissionVersion', 'AssignmentReview', 'AssignmentAttachment', 'ClassroomOperation'];
const checks: string[] = [];
let stage = 'initialization';
function checked(name: string): void { checks.push(name); stage = name; }
async function denied(name: string, action: () => Promise<unknown>, code = 'NOT_FOUND'): Promise<void> {
  stage = name; await assert.rejects(action, (reason: unknown) => typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === code); checked(name);
}
async function constrained(name: string, action: () => Promise<unknown>): Promise<void> {
  stage = name; await assert.rejects(action, (reason: unknown) => reason instanceof Prisma.PrismaClientKnownRequestError || reason instanceof Prisma.PrismaClientUnknownRequestError); checked(name);
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
  const now = new Date(), future = new Date(now.getTime() + 3600_000);
  const actors = [['owner', 'admin'], ['other-admin', 'admin'], ['student1', 'student'], ['student2', 'student'], ['outsider', 'student']];
  for (const [id, role] of actors) await db.user.create({ data: { id, role, nickname: id, email: `${id}@classroom.invalid`, passwordHash: 'isolated-fixture-not-for-login' } });
  await db.classroom.create({ data: { id: 'class-a', responsibleId: 'owner', title: '原创演示班A' } });
  await db.classroom.create({ data: { id: 'class-b', responsibleId: 'other-admin', title: '外班B' } });
  for (const studentId of ['student1', 'student2']) await db.classMember.create({ data: { classroomId: 'class-a', studentId } });
  await db.classMember.create({ data: { classroomId: 'class-b', studentId: 'outsider' } });
  assert.equal((await readClassroom(db, 'owner', 'class-a')).title, '原创演示班A'); checked('responsible reads own class');
  assert.equal((await readClassroom(db, 'student1', 'class-a')).id, 'class-a'); checked('active member reads class');
  await denied('other administrator has no global bypass', () => readClassroom(db, 'other-admin', 'class-a'));
  await denied('cross class member denied', () => readClassroom(db, 'outsider', 'class-a'));
  await denied('unknown account denied', () => readClassroom(db, 'unknown', 'class-a'));
  await denied('student cannot manage class', () => requireClassroomManager(db, 'student1', 'class-a'));
  const invite = createInviteCode();
  await db.classInvite.create({ data: { id: 'invite', classroomId: 'class-a', codeHash: invite.codeHash, expiresAt: future, maxUses: 1 } });
  assert.ok(!JSON.stringify(await readClassroom(db, 'owner', 'class-a')).includes(invite.codeHash)); checked('class DTO excludes invite hash');
  await constrained('invite quota CHECK rejects overflow', () => db.classInvite.update({ where: { id: 'invite' }, data: { usedCount: 2 } }));
  await constrained('duplicate invite digest rejected', () => db.classInvite.create({ data: { classroomId: 'class-b', codeHash: invite.codeHash, expiresAt: future, maxUses: 1 } }));
  const consumes = await Promise.all([0, 1].map(() => db.classInvite.updateMany({ where: { id: 'invite', usedCount: 0 }, data: { usedCount: { increment: 1 } } })));
  assert.equal(consumes.reduce((sum, result) => sum + result.count, 0), 1); checked('atomic invite quota premise accepts one concurrent update');
  await db.sharedCourse.create({ data: { id: 'shared', publisherId: 'owner', title: '授权原创课程', description: '', contentType: 'DOCUMENT', format: 'TXT', fileSizeBytes: 10, mediaKey: 'not-a-real-object', snapshot: {}, include: {}, rightsStatement: '原创测试', rightsConfirmed: true, state: 'PUBLISHED', requestId: randomUUID(), requestDigest: 'fixture' } });
  await db.classChapter.create({ data: { id: 'chapter', classroomId: 'class-a', title: '发布章节', sequence: 0, state: 'PUBLISHED', sharedCourseId: 'shared' } });
  await db.classChapter.create({ data: { id: 'draft-chapter', classroomId: 'class-a', title: '未发布章节', sequence: 1 } });
  await db.classChapter.create({ data: { id: 'other-chapter', classroomId: 'class-b', title: '外班章节', sequence: 0 } });
  assert.equal((await readClassChapter(db, 'student1', 'chapter')).sourceAvailable, false); checked('unprepared shared source yields no learning link');
  await db.sharedCourse.update({ where: { id: 'shared' }, data: { preparedAt: now } });
  assert.equal((await readClassChapter(db, 'student1', 'chapter')).sharedCourseId, 'shared'); checked('member reads authorized published chapter');
  await denied('draft chapter hidden from student', () => readClassChapter(db, 'student1', 'draft-chapter'));
  assert.equal((await readClassChapter(db, 'owner', 'draft-chapter')).state, 'DRAFT'); checked('responsible reads draft chapter');
  await db.sharedCourse.update({ where: { id: 'shared' }, data: { state: 'WITHDRAWN' } });
  const unavailable = await readClassChapter(db, 'student1', 'chapter'); assert.equal(unavailable.sharedCourseId, null); assert.equal(unavailable.sourceAvailable, false); checked('withdrawn shared source no longer yields learning link');
  await db.classAssignment.create({ data: { id: 'assignment', classroomId: 'class-a', chapterId: 'chapter', title: '作业', state: 'PUBLISHED', dueAt: future } });
  await db.classAssignment.create({ data: { id: 'hidden-assignment', classroomId: 'class-a', chapterId: 'draft-chapter', title: '隐藏章节下任务', state: 'PUBLISHED', dueAt: future } });
  assert.equal((await readClassAssignment(db, 'student1', 'assignment')).id, 'assignment'); checked('member reads published assignment');
  await denied('task in draft chapter remains hidden', () => readClassAssignment(db, 'student1', 'hidden-assignment'));
  await constrained('cross class chapter FK rejected', () => db.classAssignment.create({ data: { classroomId: 'class-a', chapterId: 'other-chapter', title: '非法' } }));
  await constrained('published task requires deadline CHECK', () => db.classAssignment.create({ data: { classroomId: 'class-a', title: '缺截止', state: 'PUBLISHED' } }));
  await constrained('nonmember submission FK rejected', () => db.assignmentSubmission.create({ data: { classroomId: 'class-a', assignmentId: 'assignment', studentId: 'outsider' } }));
  await db.assignmentSubmission.create({ data: { id: 'submission', classroomId: 'class-a', assignmentId: 'assignment', studentId: 'student1', state: 'RETURNED', draftText: '本人未交草稿秘密' } });
  await db.assignmentSubmission.create({ data: { id: 'draft-only', classroomId: 'class-a', assignmentId: 'assignment', studentId: 'student2', draftText: '第二学生私人草稿' } });
  await constrained('one submission per student and assignment', () => db.assignmentSubmission.create({ data: { classroomId: 'class-a', assignmentId: 'assignment', studentId: 'student1' } }));
  await constrained('submission cannot cross assignment classroom', () => db.assignmentSubmission.create({ data: { classroomId: 'class-b', assignmentId: 'assignment', studentId: 'outsider' } }));
  const version = { submissionId: 'submission', classroomId: 'class-a', studentId: 'student1', versionNo: 1, bodyText: '本人已提交版本一', assignmentTitle: '作业快照', instructionsSnapshot: '原始要求', assignmentRevision: 1, dueAtSnapshot: future };
  await db.submissionVersion.create({ data: { ...version, id: 'version1' } });
  await constrained('version cannot change submission student', () => db.submissionVersion.create({ data: { ...version, studentId: 'student2', versionNo: 2 } }));
  await constrained('submitted version number unique', () => db.submissionVersion.create({ data: version }));
  await db.assignmentReview.create({ data: { id: 'review', versionId: 'version1', classroomId: 'class-a', reviewerId: 'owner', state: 'RETURNED', feedback: '请补充依据' } });
  await denied('returned version cannot be reviewed again', () => authorizeAssignmentReview(db, 'owner', 'version1'), 'CLASSROOM_CONFLICT');
  const ownerView = await readAssignmentSubmission(db, 'owner', 'submission');
  assert.ok(!('draftText' in ownerView)); assert.ok(!JSON.stringify(ownerView).includes('本人未交草稿秘密')); assert.equal(ownerView.versions[0].bodyText, version.bodyText); checked('responsible sees frozen submission only');
  assert.equal((await readAssignmentSubmission(db, 'student1', 'submission')).draftText, '本人未交草稿秘密'); checked('active owner reads own returned draft');
  await denied('responsible cannot discover draft only submission', () => readAssignmentSubmission(db, 'owner', 'draft-only'));
  await denied('other student cannot read peer feedback', () => readAssignmentSubmission(db, 'student2', 'submission'));
  await denied('other administrator cannot read submission', () => readAssignmentSubmission(db, 'other-admin', 'submission'));
  const file = { submissionId: 'submission', classroomId: 'class-a', studentId: 'student1', fileName: '作业.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'a'.repeat(64), expiresAt: future };
  await db.assignmentAttachment.create({ data: { ...file, id: 'ready-file', state: 'READY', storageKey: attachmentStorageKey('class-a', 'student1', 'ready-file', file.mimeType) } });
  await db.assignmentAttachment.create({ data: { ...file, id: 'frozen-file', state: 'ATTACHED', versionId: 'version1', storageKey: attachmentStorageKey('class-a', 'student1', 'frozen-file', file.mimeType) } });
  assert.equal((await authorizeAssignmentAttachment(db, 'student1', 'ready-file')).fileName, '作业.pdf'); checked('student may access own ready draft attachment');
  await denied('responsible cannot download draft attachment', () => authorizeAssignmentAttachment(db, 'owner', 'ready-file'));
  await denied('peer cannot download attached version', () => authorizeAssignmentAttachment(db, 'student2', 'frozen-file'));
  assert.equal((await authorizeAssignmentAttachment(db, 'owner', 'frozen-file')).sizeBytes, 10); checked('responsible authorized for formally attached file');
  await denied('expired draft attachment denied', () => authorizeAssignmentAttachment(db, 'student1', 'ready-file', new Date(future.getTime() + 1)));
  await constrained('attachment version must belong to same submission', () => db.assignmentAttachment.create({ data: { ...file, id: 'bad-file', submissionId: 'draft-only', studentId: 'student2', state: 'ATTACHED', versionId: 'version1', storageKey: attachmentStorageKey('class-a', 'student2', 'bad-file', file.mimeType) } }));
  await constrained('ready file requires verified digest', () => db.assignmentAttachment.create({ data: { ...file, id: 'no-digest', sha256: null, state: 'READY', storageKey: attachmentStorageKey('class-a', 'student1', 'no-digest', file.mimeType) } }));
  await constrained('file key cannot point at other namespace', () => db.assignmentAttachment.create({ data: { ...file, id: 'bad-key', state: 'READY', storageKey: 'private/elsewhere.pdf' } }));
  await db.classMember.update({ where: { classroomId_studentId: { classroomId: 'class-a', studentId: 'student1' } }, data: { state: 'LEFT' } });
  await denied('departed student loses class view', () => readClassroom(db, 'student1', 'class-a'));
  const historical = await readAssignmentSubmission(db, 'student1', 'submission'); assert.ok(!('draftText' in historical)); assert.equal(historical.versions[0].review?.feedback, '请补充依据'); checked('departed student retains own submitted feedback only');
  await denied('departed student loses unpublished file', () => authorizeAssignmentAttachment(db, 'student1', 'ready-file'));
  assert.equal((await authorizeAssignmentAttachment(db, 'student1', 'frozen-file', new Date(future.getTime() + 1))).fileName, '作业.pdf'); checked('frozen historical file unaffected by draft expiry');
  await db.classMember.update({ where: { classroomId_studentId: { classroomId: 'class-a', studentId: 'student1' } }, data: { state: 'REMOVED' } });
  assert.equal((await readAssignmentSubmission(db, 'student1', 'submission')).versions.length, 1); checked('removed student retains same own history boundary');
  await db.submissionVersion.create({ data: { ...version, id: 'version2', versionNo: 2, bodyText: '重交版本' } });
  await db.assignmentSubmission.update({ where: { id: 'submission' }, data: { state: 'SUBMITTED' } });
  assert.equal((await authorizeAssignmentReview(db, 'owner', 'version2')).versionId, 'version2'); checked('responsible may review latest submitted version');
  await denied('stale submitted version cannot be reviewed', () => authorizeAssignmentReview(db, 'owner', 'version1'), 'CLASSROOM_CONFLICT');
  await denied('other admin cannot authorize formal grading', () => authorizeAssignmentReview(db, 'other-admin', 'version2'));
  await constrained('grade reviewer must be classroom responsible', () => db.assignmentReview.create({ data: { versionId: 'version2', classroomId: 'class-a', reviewerId: 'other-admin', state: 'GRADED', score: 80, feedback: '非法' } }));
  await constrained('graded score cannot be null', () => db.assignmentReview.create({ data: { versionId: 'version2', classroomId: 'class-a', reviewerId: 'owner', state: 'GRADED', feedback: '缺分' } }));
  await constrained('score cannot exceed 100', () => db.assignmentReview.create({ data: { versionId: 'version2', classroomId: 'class-a', reviewerId: 'owner', state: 'GRADED', score: 101, feedback: '越界' } }));
  await db.assignmentReview.create({ data: { versionId: 'version2', classroomId: 'class-a', reviewerId: 'owner', state: 'GRADED', score: 0, feedback: '请完整订正' } });
  assert.equal((await readAssignmentSubmission(db, 'student1', 'submission')).versions[0].review?.score, 0); checked('real zero grade remains distinct from unknown');
  await denied('already reviewed current version cannot be overwritten', () => authorizeAssignmentReview(db, 'owner', 'version2'), 'CLASSROOM_CONFLICT');
  await db.user.update({ where: { id: 'owner' }, data: { role: 'student' } });
  await denied('database role change revokes responsible access', () => readClassroom(db, 'owner', 'class-a'));
  await db.user.update({ where: { id: 'owner' }, data: { role: 'admin' } });
  const requestId = randomUUID(), inputDigest = classRequestDigest('SUBMIT', { submissionId: 'submission', revision: 1 });
  await db.classroomOperation.create({ data: { classroomId: 'class-a', actorId: 'student1', requestId, inputDigest, action: 'SUBMIT', resultId: 'version2' } });
  await constrained('idempotency key cannot be reused across actions', () => db.classroomOperation.create({ data: { classroomId: 'class-a', actorId: 'student1', requestId, inputDigest, action: 'DRAFT', resultId: 'other' } }));
  const races = await Promise.all([0, 1].map(() => db.assignmentSubmission.updateMany({ where: { id: 'submission', revision: 1 }, data: { revision: { increment: 1 } } })));
  assert.equal(races.reduce((sum, result) => sum + result.count, 0), 1); checked('CAS premise permits only one concurrent revision write');
  await db.classroom.update({ where: { id: 'class-a' }, data: { state: 'ARCHIVED' } });
  assert.equal((await readClassroom(db, 'student2', 'class-a')).state, 'ARCHIVED'); checked('archive keeps published read access for active member');
  await denied('archive blocks manager writes', () => requireClassroomAccess(db, 'owner', 'class-a', true), 'CLASSROOM_CONFLICT');
  await denied('archive blocks official review authorization', () => authorizeAssignmentReview(db, 'owner', 'version2'), 'CLASSROOM_CONFLICT');
  assert.equal((await readAssignmentSubmission(db, 'student1', 'submission')).versions.length, 2); checked('archive retains submitted version history');
  await denied('archive does not expose a private draft as history', () => readAssignmentSubmission(db, 'student2', 'draft-only'));
  await constrained('deleting classroom cannot cascade away submitted history', () => db.classroom.delete({ where: { id: 'class-a' } }));
  await constrained('deleting a classroom responsible preserves history', () => db.user.delete({ where: { id: 'owner' } }));
  await constrained('deleting a removed student preserves submitted history', () => db.user.delete({ where: { id: 'student1' } }));
}

async function main(): Promise<void> {
  const mainUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(mainUrl.hostname), 'Local PostgreSQL only');
  const name = `slp_class_accept_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^slp_class_accept_[a-f0-9]{32}$/u);
  const isolatedUrl = new URL(mainUrl); isolatedUrl.pathname = `/${name}`;
  assert.notEqual(isolatedUrl.pathname, mainUrl.pathname);
  const adminUrl = new URL(mainUrl); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } }), local = new PrismaClient({ datasources: { db: { url: mainUrl.toString() } } });
  let isolated: PrismaClient | undefined, created = false;
  try {
    stage = 'snapshot existing local data'; const originalTables = (await snapshot(local)).filter((table) => !newTables.includes(table.name)); const config = envDigest();
    stage = 'create isolated database'; await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
    stage = 'deploy isolated migrations'; migrate(isolatedUrl.toString());
    isolated = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    await exercise(isolated);
    const apply = process.argv.includes('--apply-local');
    if (apply) { stage = 'deploy local additive migration'; migrate(mainUrl.toString()); checked('local additive migration deployed'); }
    assert.deepEqual(await snapshot(local, originalTables.map((table) => table.name)), originalTables); checked('all original business table digests preserved');
    assert.deepEqual(envDigest(), config); checked('environment files unchanged');
    if (apply) { const added = await snapshot(local, newTables); assert.ok(added.every((table) => table.count === '0')); checked('ten new local tables are empty'); }
    writeFileSync(`${root}/report.json`, JSON.stringify({ state: 'PASSED', date: new Date().toISOString(), checks, count: checks.length, originalTables: originalTables.length, isolatedDatabase: true, localMigrationApplied: apply, configUnchanged: true, originalDataUnchanged: true, realModelCalled: false, httpWriteWorkflowsImplemented: false }, null, 2));
  } finally {
    await isolated?.$disconnect(); await local.$disconnect();
    if (created) {
      assert.match(name, /^slp_class_accept_[a-f0-9]{32}$/u); assert.notEqual(`/${name}`, mainUrl.pathname);
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.$disconnect();
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
