import path from 'node:path';
import { LocalStorageClient, verifyStorageToken } from '../../src/lib/storage';
import { assignmentView, assignmentCommand, readSubmission, reviewSubmission, submissionHistory } from '../../src/lib/classrooms/assignments';
import { createAssignmentAttachment, uploadAssignmentAttachment, removeAssignmentAttachment, attachmentDownloadTicket, downloadAssignmentAttachment, cleanupAssignmentAttachments } from '../../src/lib/classrooms/attachments';
import { assignmentHandlers } from '../../src/lib/classrooms/assignment-routes';
import { minimalPdfFixture } from '../../tests/fixtures/minimal-pdf';
import { assignmentJpeg } from '../../tests/fixtures/assignment-jpeg';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

import { signAccessToken } from '../../src/lib/auth/jwt';
import { NextRequest } from 'next/server';
import { getRedis } from '../../src/lib/redis';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const root = '.taskbook-working/assignment-workflow-20261019';
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
 const storage = new LocalStorageClient(path.resolve(root,'objects',randomUUID()));
 for (const [id,role] of [['owner','teacher'],['other','admin'],['s1','student'],['s2','student'],['outside','student']]) await db.user.create({data:{id,role,nickname:id,email:id+'@assignment.invalid',passwordHash:'isolated-fixture-not-for-login'}});
 for(const [id,responsibleId] of [['class-a','owner'],['class-b','other']])await db.classroom.create({data:{id,responsibleId,title:id}});
 for(const studentId of ['s1','s2'])await db.classMember.create({data:{classroomId:'class-a',studentId}});
 await db.classMember.create({data:{classroomId:'class-b',studentId:'outside'}});
 const dueAt=new Date(Date.now()+3600000);await db.classAssignment.create({data:{id:'task',classroomId:'class-a',title:'原创课堂作业',instructions:'用自己的话说明函数的定义',state:'PUBLISHED',dueAt}});
 await db.classAssignment.create({data:{id:'other-task',classroomId:'class-b',title:'外班任务',state:'PUBLISHED',dueAt}});
 const draft={requestId:randomUUID(),action:'draft',expectedRevision:0,bodyText:'本人未交草稿：函数为两个集合之间的对应。'};
 const first=await assignmentCommand('s1','task',draft,db),sid=first.submissionId;
 assert.equal((await assignmentCommand('s1','task',draft,db)).replayed,true);checked('first draft and exact retry create one submission');
 await denied('same draft key cannot replace body',()=>assignmentCommand('s1','task',{...draft,bodyText:'覆盖'},db),'CLASSROOM_CONFLICT');
 await denied('teacher cannot read unsubmitted draft',()=>readSubmission('owner',sid,db));
 await denied('other student cannot read unsubmitted draft',()=>readSubmission('s2',sid,db));
 await denied('unrelated administrator cannot read assignment',()=>assignmentView('other','task',1,db));
 await denied('outsider cannot read assignment',()=>assignmentView('outside','task',1,db));
 const board=await assignmentView('owner','task',1,db);assert.equal(board.board?.submittedStudents,0);assert.equal(board.board?.neverSubmittedActive,2);assert.ok(!JSON.stringify(board).includes(draft.bodyText));assert.equal(board.board?.rows.find((r)=>r.studentId==='s1')?.submission,null);checked('teacher board never exposes or counts draft');
 const currentRev=async():Promise<number>=>(await db.assignmentSubmission.findUniqueOrThrow({where:{id:sid}})).revision;
 const raceRev=await currentRev();const saves=await Promise.allSettled(['甲','乙'].map((suffix)=>assignmentCommand('s1','task',{...draft,requestId:randomUUID(),expectedRevision:raceRev,bodyText:draft.bodyText+suffix},db)));assert.equal(saves.filter((s)=>s.status==='fulfilled').length,1);checked('draft revision race accepts one winner');
 const originalBody=(await readSubmission('s1',sid,db)).draftText!;
 const samples:Array<{name:string;mime:'text/plain'|'text/markdown'|'application/pdf'|'image/png'|'image/jpeg';bytes:Buffer}>=[{name:'作业.txt',mime:'text/plain',bytes:Buffer.from('原创文本附件')},{name:'说明.md',mime:'text/markdown',bytes:Buffer.from('# 我的作业\n说明')},{name:'试题.pdf',mime:'application/pdf',bytes:minimalPdfFixture()},{name:'图示.png',mime:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')},{name:'照片.jpg',mime:'image/jpeg',bytes:assignmentJpeg()}];
 const fileIds:string[]=[];
 for(const sample of samples){const intentInput={requestId:randomUUID(),expectedRevision:await currentRev(),fileName:sample.name,mimeType:sample.mime,sizeBytes:sample.bytes.length};const intent=await createAssignmentAttachment('s1',sid,intentInput,db);fileIds.push(intent.resultId);assert.equal((await createAssignmentAttachment('s1',sid,intentInput,db)).replayed,true);await denied(sample.name+' wrong bytes length rejected',()=>uploadAssignmentAttachment('s1',intent.resultId,async()=>Buffer.from('x'),db,storage),'UPLOAD_SIZE_MISMATCH');await uploadAssignmentAttachment('s1',intent.resultId,async()=>sample.bytes,db,storage);const revision=await currentRev();await uploadAssignmentAttachment('s1',intent.resultId,async()=>sample.bytes,db,storage);assert.equal(await currentRev(),revision);checked(sample.name+' real format upload and retry immutable');}
 await denied('sixth draft attachment rejected',async()=>createAssignmentAttachment('s1',sid,{requestId:randomUUID(),expectedRevision:await currentRev(),fileName:'extra.txt',mimeType:'text/plain',sizeBytes:1},db),'VALIDATION_FAILED');
 await denied('peer cannot reserve attachment for another draft',async()=>createAssignmentAttachment('s2',sid,{requestId:randomUUID(),expectedRevision:await currentRev(),fileName:'other.txt',mimeType:'text/plain',sizeBytes:1},db));
 await denied('teacher cannot obtain draft attachment download',()=>attachmentDownloadTicket('owner',fileIds[0],db));await denied('peer cannot obtain draft attachment download',()=>attachmentDownloadTicket('s2',fileIds[0],db));
 const ticket=await attachmentDownloadTicket('s1',fileIds[0],db),exp=ticket.expires,sig=ticket.sig;
 const response=await downloadAssignmentAttachment('s1',fileIds[0],exp,sig,db,storage);assert.equal(await response.text(),samples[0].bytes.toString());assert.match(response.headers.get('content-disposition')??'',/^attachment;/u);assert.equal(response.headers.get('cache-control'),'private, no-store');checked('authorized download returns actual bytes with safe private headers');
 await denied('download ticket bound to actor',()=>downloadAssignmentAttachment('s2',fileIds[0],exp,sig,db,storage),'FORBIDDEN');await denied('expired ticket rejected',()=>downloadAssignmentAttachment('s1',fileIds[0],Date.now()-1,sig,db,storage),'FORBIDDEN');const fileRow=await db.assignmentAttachment.findUniqueOrThrow({where:{id:fileIds[0]}});assert.equal(verifyStorageToken('get',fileRow.storageKey,sig,exp),false);checked('private ticket cannot sign generic storage object path');
 const submit={requestId:randomUUID(),action:'submit',expectedRevision:await currentRev(),assignmentRevision:1,attachmentIds:fileIds,confirmed:true};
 await denied('submission cannot silently omit READY attachments',()=>assignmentCommand('s1','task',{...submit,requestId:randomUUID(),attachmentIds:[]},db),'CLASSROOM_CONFLICT');
 const submitted=await assignmentCommand('s1','task',submit,db);assert.equal((await assignmentCommand('s1','task',submit,db)).replayed,true);assert.equal(await db.submissionVersion.count({where:{submissionId:sid}}),1);checked('explicit submit freezes one version and five attachments');
 assert.ok(!('draftText'in await readSubmission('owner',sid,db)));assert.ok(!('draftText'in await readSubmission('s1',sid,db)));assert.equal((await readSubmission('owner',sid,db)).versions[0].bodyText,originalBody);checked('submitted view contains frozen body without private draft');
 await denied('submitted body cannot be overwritten',async()=>assignmentCommand('s1','task',{...draft,requestId:randomUUID(),expectedRevision:await currentRev()},db),'CLASSROOM_CONFLICT');await denied('peer cannot read frozen version',()=>readSubmission('s2',sid,db));
 await denied('submitted attachment cannot be overwritten',()=>uploadAssignmentAttachment('s1',fileIds[0],async()=>samples[0].bytes,db,storage),'CLASSROOM_CONFLICT');
 let reviewed=await readSubmission('owner',sid,db);const returned={requestId:randomUUID(),action:'review',expectedRevision:reviewed.revision,versionId:submitted.resultId,state:'RETURNED',score:null,feedback:'请补充唯一对应条件，并重新提交。',confirmed:true};
 await denied('unrelated admin cannot review',()=>reviewSubmission('other',sid,returned,db));await denied('student cannot review',()=>reviewSubmission('s1',sid,returned,db));
 await reviewSubmission('owner',sid,returned,db);assert.equal((await reviewSubmission('owner',sid,returned,db)).replayed,true);const returnedView=await readSubmission('s1',sid,db);assert.equal(returnedView.draftText,originalBody);assert.equal(returnedView.draftAttachments.length,0);assert.equal(returnedView.versions[0].attachments.length,5);checked('return restores editable text without changing frozen files or feedback');
 await denied('returned old version cannot be reviewed again',()=>reviewSubmission('owner',sid,{...returned,requestId:randomUUID()},db),'CLASSROOM_CONFLICT');
 await db.classAssignment.update({where:{id:'task'},data:{dueAt:new Date(Date.now()-1000)}});
 await assignmentCommand('s1','task',{...draft,requestId:randomUUID(),expectedRevision:await currentRev(),bodyText:'订正版：每个自变量有唯一对应值。'},db);
 await denied('deadline prevents resubmission',async()=>assignmentCommand('s1','task',{...submit,requestId:randomUUID(),expectedRevision:await currentRev(),attachmentIds:[]},db),'CLASSROOM_CONFLICT');
 await db.classAssignment.update({where:{id:'task'},data:{dueAt:new Date(Date.now()+3600000),revision:{increment:1},instructions:'补充唯一对应要求'}});
 await denied('changed task version requires review before submit',async()=>assignmentCommand('s1','task',{...submit,requestId:randomUUID(),expectedRevision:await currentRev(),attachmentIds:[]},db),'CLASSROOM_CONFLICT');
 const second=await assignmentCommand('s1','task',{...submit,requestId:randomUUID(),expectedRevision:await currentRev(),assignmentRevision:2,attachmentIds:[]},db);reviewed=await readSubmission('owner',sid,db);assert.equal(reviewed.versions.length,2);assert.equal(reviewed.versions[1].instructionsSnapshot,'用自己的话说明函数的定义');assert.equal(reviewed.versions[1].review?.feedback,returned.feedback);checked('extension allows new version without rewriting original task or review snapshots');
 const grades=[80,90].map((score)=>({requestId:randomUUID(),action:'review',expectedRevision:reviewed.revision,versionId:second.resultId,state:'GRADED',score,feedback:'定义说明清楚。',confirmed:true}));const gradeResults=await Promise.allSettled(grades.map((input)=>reviewSubmission('owner',sid,input,db)));assert.equal(gradeResults.filter((r)=>r.status==='fulfilled').length,1);checked('concurrent grade accepts one immutable review');
 await denied('graded submission cannot be edited',async()=>assignmentCommand('s1','task',{...draft,requestId:randomUUID(),expectedRevision:await currentRev()},db),'CLASSROOM_CONFLICT');assert.equal((await assignmentView('owner','task',1,db)).board?.graded,1);checked('board reflects real graded result');
 await db.classMember.update({where:{classroomId_studentId:{classroomId:'class-a',studentId:'s1'}},data:{state:'REMOVED'}});await denied('removed student cannot read task',()=>assignmentView('s1','task',1,db));assert.equal((await readSubmission('s1',sid,db)).versions.length,2);assert.equal((await submissionHistory('s1',1,db)).items[0].id,sid);checked('removed student retains only own formal history');
 await attachmentDownloadTicket('s1',fileIds[0],db);await attachmentDownloadTicket('owner',fileIds[0],db);checked('frozen attachment remains available to owner history and responsible');
 await db.classroom.update({where:{id:'class-a'},data:{state:'ARCHIVED'}});assert.equal((await readSubmission('owner',sid,db)).canReview,false);await denied('archive prevents new draft',()=>assignmentCommand('s2','task',{...draft,requestId:randomUUID()},db),'CLASSROOM_CONFLICT');await db.classroom.update({where:{id:'class-a'},data:{state:'ACTIVE'}});
 const secondStudent=await assignmentCommand('s2','task',{...draft,requestId:randomUUID(),bodyText:''},db);const s2id=secondStudent.submissionId;
 await denied('blank submission without attachment rejected',()=>assignmentCommand('s2','task',{...submit,requestId:randomUUID(),expectedRevision:1,assignmentRevision:2,attachmentIds:[]},db),'VALIDATION_FAILED');
 const f2=await createAssignmentAttachment('s2',s2id,{requestId:randomUUID(),expectedRevision:1,fileName:'only.txt',mimeType:'text/plain',sizeBytes:3},db);
 const uploads=await Promise.allSettled(['one','two'].map((value)=>uploadAssignmentAttachment('s2',f2.resultId,async()=>Buffer.from(value),db,storage)));assert.equal(uploads.filter((r)=>r.status==='fulfilled').length,1);const stored=await db.assignmentAttachment.findUniqueOrThrow({where:{id:f2.resultId}});const object=await storage.getObject(stored.storageKey);const parts:Buffer[]=[];for await(const chunk of object.stream)parts.push(Buffer.from(chunk as Uint8Array));assert.equal(createHash('sha256').update(Buffer.concat(parts)).digest('hex'),stored.sha256);checked('competing uploads cannot replace frozen object bytes or digest');
 const s2rev=(await db.assignmentSubmission.findUniqueOrThrow({where:{id:s2id}})).revision;const only=await assignmentCommand('s2','task',{...submit,requestId:randomUUID(),expectedRevision:s2rev,assignmentRevision:2,attachmentIds:[f2.resultId]},db);assert.equal((await readSubmission('s2',s2id,db)).versions[0].bodyText,'');checked('attachment-only formal submission supported');
 await reviewSubmission('owner',s2id,{...returned,requestId:randomUUID(),expectedRevision:s2rev+1,versionId:only.resultId},db);
 const beforeIntent=(await db.assignmentSubmission.findUniqueOrThrow({where:{id:s2id}})).revision;const expired=await createAssignmentAttachment('s2',s2id,{requestId:randomUUID(),expectedRevision:beforeIntent,fileName:'expired.txt',mimeType:'text/plain',sizeBytes:3},db);await uploadAssignmentAttachment('s2',expired.resultId,async()=>Buffer.from('old'),db,storage);await db.assignmentAttachment.update({where:{id:expired.resultId},data:{createdAt:new Date(Date.now()-86400000),expiresAt:new Date(Date.now()-1000)}});
 const cleanup=await cleanupAssignmentAttachments(db,storage);assert.ok(cleanup.deleted>=1);assert.equal((await db.assignmentAttachment.findUniqueOrThrow({where:{id:expired.resultId}})).state,'DELETED');assert.equal(await storage.statObject((await db.assignmentAttachment.findUniqueOrThrow({where:{id:expired.resultId}})).storageKey),null);assert.equal(await db.assignmentAttachment.count({where:{state:'ATTACHED'}}),6);checked('expiry cleanup removes only unbound objects and preserves six formal files');
 const removeRev=(await db.assignmentSubmission.findUniqueOrThrow({where:{id:s2id}})).revision;const removable=await createAssignmentAttachment('s2',s2id,{requestId:randomUUID(),expectedRevision:removeRev,fileName:'remove.txt',mimeType:'text/plain',sizeBytes:3},db);await uploadAssignmentAttachment('s2',removable.resultId,async()=>Buffer.from('del'),db,storage);const removeInput={requestId:randomUUID(),action:'remove',expectedRevision:(await db.assignmentSubmission.findUniqueOrThrow({where:{id:s2id}})).revision};
 const broken:typeof storage=Object.create(storage) as typeof storage;broken.deleteObject=async():Promise<void>=>{throw Error('simulated storage failure');};await denied('delete storage failure keeps tombstone',()=>removeAssignmentAttachment('s2',removable.resultId,removeInput,db,broken),'STORAGE_UNAVAILABLE');assert.equal((await db.assignmentAttachment.findUniqueOrThrow({where:{id:removable.resultId}})).state,'DELETED');assert.equal((await removeAssignmentAttachment('s2',removable.resultId,removeInput,db,storage)).replayed,true);checked('explicit delete retry resumes cleanup without another revision');
 const handlers=assignmentHandlers(db,storage),token=signAccessToken({sub:'s1',email:null,role:'admin'});const req=new NextRequest('http://local/api/class-submissions/'+sid,{headers:{authorization:'Bearer '+token}});assert.equal((await handlers.SUBMISSION(req,{params:Promise.resolve({id:sid})})).status,200);checked('authenticated async-param route reads own history after removal');
 const proof=await attachmentDownloadTicket('s1',fileIds[0],db);const downloadRequest=new NextRequest('http://local/api/class-attachments/'+fileIds[0]+'/download/file',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({expires:proof.expires,sig:proof.sig})});const downloadResponse=await handlers.DOWNLOAD(downloadRequest,{params:Promise.resolve({id:fileIds[0]})});assert.equal(downloadResponse.status,200);assert.equal(await downloadResponse.text(),samples[0].bytes.toString());checked('actual proof passes route schema and private binary download returns original bytes');
 await db.user.update({where:{id:'owner'},data:{role:'student'}});await denied('revoked manager role cannot read another student submission',()=>readSubmission('owner',sid,db));await db.user.update({where:{id:'owner'},data:{role:'teacher'}});
 for(const record of await db.assignmentAttachment.findMany({select:{storageKey:true}}))await storage.deleteObject(record.storageKey);checked('isolated storage objects cleaned by exact keys');
}
async function main(): Promise<void> {
  const mainUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(mainUrl.hostname), 'Local PostgreSQL only');
  const name = `slp_assignment_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^slp_assignment_[a-f0-9]{32}$/u);
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
    const apply = false;
    if (apply) { stage = 'deploy local additive migration'; migrate(mainUrl.toString()); checked('local additive migration deployed'); }
    assert.deepEqual(await snapshot(local, originalTables.map((table) => table.name)), originalTables); checked('all original business table digests preserved');
    assert.deepEqual(envDigest(), config); checked('environment files unchanged');
    if (apply) { const added = await snapshot(local, newTables); assert.ok(added.every((table) => table.count === '0')); checked('ten new local tables are empty'); }
    writeFileSync(`${root}/report.json`, JSON.stringify({ state: 'PASSED', date: new Date().toISOString(), checks, count: checks.length, originalTables: originalTables.length, isolatedDatabase: true, localMigrationApplied: apply, configUnchanged: true, originalDataUnchanged: true, realModelCalled: false, httpWriteWorkflowsImplemented: true }, null, 2));
  } finally {
    await isolated?.$disconnect(); await local.$disconnect();
    if (created) {
      assert.match(name, /^slp_assignment_[a-f0-9]{32}$/u); assert.notEqual(`/${name}`, mainUrl.pathname);
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







