import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { getStorage, getStorageDriver } from '../../src/lib/storage';
import { attachmentStorageKey } from '../../src/lib/classrooms/rules';
import { hashPassword } from '../../src/lib/auth/password';
import { assignmentCommand, readSubmission, reviewSubmission } from '../../src/lib/classrooms/assignments';
loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const root = '.taskbook-working/homework-recognition-20261019', owner = 'qa-homework-owner-20261019', student = 'qa-homework-student-20261019', student2 = 'qa-homework-student2-20261019', classroomId = 'qa-homework-class-20261019', assignmentId = 'qa-homework-task-20261019';
type Digest = { name: string; count: string; digest: string };
const envDigest = (): string[] => ['.env', '.env.local'].map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'));
async function snapshot(db: PrismaClient): Promise<Digest[]> {
 const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
 const result: Digest[] = [];
 for (const { name } of tables) { if (!/^[A-Za-z0-9_]+$/u.test(name)) throw Error('unsafe table'); const [row] = await db.$queryRawUnsafe<Array<{ count: string; digest: string }>>(`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM "${name}" t`); result.push({ name, ...row }); }
 return result;
}
async function main(): Promise<void> {
 const url = new URL(process.env.DATABASE_URL ?? ''); if (!['localhost','127.0.0.1'].includes(url.hostname)) throw Error('local DB only');
 const db = new PrismaClient();
 try {
  if (process.argv.includes('setup')) {
   if (await db.user.count({ where: { id: { in: [owner, student, student2] } } })) throw Error('fixture already exists, cleanup first');
   if(getStorageDriver()!=='local')throw Error('UI acceptance requires existing local storage');
   const before = await snapshot(db); writeFileSync(root + '/ui-baseline.json', JSON.stringify({ before, env: envDigest() }));
   const passwordHash = await hashPassword('Classroom-UI-test-20261019!');
   for (const [id, role, nickname] of [[owner,'admin','班级负责人验收'],[student,'student','作业学生一验收'],[student2,'student','作业学生二验收']]) await db.user.create({ data: { id, role, nickname, email: id + '@example.com', passwordHash } });
   await db.classroom.create({data:{id:classroomId,responsibleId:owner,title:'作业闭环·临时验收班',description:'原创测试课堂，验收后精确清理'}});
   for(const studentId of [student,student2])await db.classMember.create({data:{classroomId,studentId}});
   await db.classAssignment.create({data:{id:assignmentId,classroomId,title:'函数定义与例子',instructions:'请说明函数的唯一对应条件，并给出一个例子。可附TXT/PDF或图片。',state:'PUBLISHED',dueAt:new Date(Date.now()+172800000)}});
   console.log('Temporary assignment UI fixtures ready; original accounts untouched.');
  } else if (process.argv.includes('prepare-feedback')) {
   const task = await db.classAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { classroom: true } });
   if (task.classroomId !== classroomId || task.classroom.responsibleId !== owner || await db.assignmentSubmission.count({ where: { assignmentId } })) throw Error('fresh owned UI fixture required');
   const first = await assignmentCommand(student, assignmentId, { action: 'draft', requestId: randomUUID(), expectedRevision: 0, bodyText: '函数是从集合A到集合B的对应。例子：f(x)=x+1。' }, db);
   let detail = await readSubmission(student, first.submissionId, db);
   await assignmentCommand(student, assignmentId, { action: 'submit', requestId: randomUUID(), expectedRevision: detail.revision, assignmentRevision: task.revision, attachmentIds: [], confirmed: true }, db);
   detail = await readSubmission(owner, first.submissionId, db);
   await reviewSubmission(owner, first.submissionId, { action: 'review', requestId: randomUUID(), expectedRevision: detail.revision, versionId: detail.versions[0].id, state: 'RETURNED', score: null, feedback: '请补充唯一对应条件和定义域。', confirmed: true }, db);
   detail = await readSubmission(student, first.submissionId, db);
   await assignmentCommand(student, assignmentId, { action: 'draft', requestId: randomUUID(), expectedRevision: detail.revision, bodyText: '函数是从集合A到集合B的对应：A中每个元素在B中都有唯一对应元素。例子：A、B均为实数集，f(x)=x+1。' }, db);
   detail = await readSubmission(student, first.submissionId, db);
   await assignmentCommand(student, assignmentId, { action: 'submit', requestId: randomUUID(), expectedRevision: detail.revision, assignmentRevision: task.revision, attachmentIds: [], confirmed: true }, db);
   detail = await readSubmission(owner, first.submissionId, db);
   await reviewSubmission(owner, first.submissionId, { action: 'review', requestId: randomUUID(), expectedRevision: detail.revision, versionId: detail.versions[0].id, state: 'GRADED', score: 85, feedback: '已补充唯一对应条件和定义域。定义与例子清楚，建议再说明值域。', confirmed: true }, db);
   writeFileSync(root + '/feedback-fixture.json', JSON.stringify({ submissionId: first.submissionId, score: 85, versions: 2, preparedThroughApplicationServices: true }));
   console.log('Temporary feedback prepared through application services; no real user data changed.');
  } else if (process.argv.includes('cleanup')) {
   const ids = [owner, student, student2];
   await db.$transaction(async (tx): Promise<void> => {
    const rooms = await tx.classroom.findMany({ where: { responsibleId: owner }, select: { id: true } }), classIds = rooms.map((r) => r.id);
    // Only the two exact test actors and their fresh classroom records are eligible.
    if (await tx.classMember.count({ where: { classroomId: { in: classIds }, studentId: { notIn: ids } } })) throw Error('unexpected real member; refuse cleanup');
    const files=await tx.assignmentAttachment.findMany({where:{classroomId:{in:classIds}}});
    for(const file of files){const key=attachmentStorageKey(file.classroomId,file.studentId,file.id,file.mimeType);if(key!==file.storageKey||!ids.includes(file.studentId))throw Error('unsafe fixture key');await getStorage().deleteObject(key);}
    await tx.assignmentReview.deleteMany({where:{classroomId:{in:classIds}}});
    await tx.assignmentAttachment.deleteMany({where:{classroomId:{in:classIds}}});
    await tx.submissionVersion.deleteMany({where:{classroomId:{in:classIds}}});
    await tx.assignmentSubmission.deleteMany({where:{classroomId:{in:classIds}}});
    await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await tx.classroomOperation.deleteMany({ where: { classroomId: { in: classIds } } });
    await tx.classAssignment.deleteMany({ where: { classroomId: { in: classIds } } });
    await tx.classChapter.deleteMany({ where: { classroomId: { in: classIds } } });
    await tx.classInvite.deleteMany({ where: { classroomId: { in: classIds } } });
    await tx.classMember.deleteMany({ where: { classroomId: { in: classIds } } });
    await tx.classroom.deleteMany({ where: { id: { in: classIds }, responsibleId: owner } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
   });
   const baseline = JSON.parse(readFileSync(root + '/ui-baseline.json','utf8')) as { before: Digest[]; env: string[] };
   const after = await snapshot(db), dataPreserved = JSON.stringify(after) === JSON.stringify(baseline.before), envPreserved = JSON.stringify(envDigest()) === JSON.stringify(baseline.env);
   writeFileSync(root + '/ui-cleanup.json', JSON.stringify({ cleaned: true, originalTableCount: after.length, dataPreserved, envPreserved, before: baseline.before, after }, null, 2));
   console.log(JSON.stringify({ cleaned: true, dataPreserved, envPreserved }));
   if (!dataPreserved || !envPreserved) process.exitCode = 1;
  } else throw Error('use setup, prepare-feedback or cleanup');
 } finally { await db.$disconnect(); }
}
main().catch((): void => { console.error('UI fixture operation failed; inspect exact fixture state locally.'); process.exitCode = 1; });

