import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { hashPassword } from '../../src/lib/auth/password';
loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const root = '.taskbook-working/classroom-workflow-20261019', owner = 'qa-class-owner-20261019', student = 'qa-class-student-20261019';
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
   if (await db.user.count({ where: { id: { in: [owner, student] } } })) throw Error('fixture already exists, cleanup first');
   const before = await snapshot(db); writeFileSync(root + '/ui-baseline.json', JSON.stringify({ before, env: envDigest() }));
   const passwordHash = await hashPassword('Classroom-UI-test-20261019!');
   for (const [id, role, nickname] of [[owner,'admin','班级负责人验收'],[student,'student','班级学生验收']]) await db.user.create({ data: { id, role, nickname, email: id + '@example.com', passwordHash } });
   console.log('Temporary classroom UI fixtures ready; original accounts untouched.');
  } else if (process.argv.includes('cleanup')) {
   const ids = [owner, student];
   await db.$transaction(async (tx): Promise<void> => {
    const rooms = await tx.classroom.findMany({ where: { responsibleId: owner }, select: { id: true } }), classIds = rooms.map((r) => r.id);
    // Only the two exact test actors and their fresh classroom records are eligible.
    if (await tx.classMember.count({ where: { classroomId: { in: classIds }, studentId: { notIn: ids } } })) throw Error('unexpected real member; refuse cleanup');
    if (await tx.assignmentSubmission.count({ where: { classroomId: { in: classIds } } })) throw Error('unexpected submissions; refuse cleanup');
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
  } else throw Error('use setup or cleanup');
 } finally { await db.$disconnect(); }
}
main().catch((): void => { console.error('UI fixture operation failed; inspect exact fixture state locally.'); process.exitCode = 1; });
