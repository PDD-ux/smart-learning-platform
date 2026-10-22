import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
loadEnvConfig(process.cwd(),true);
async function main():Promise<void> {
 const {PrismaClient}=await import('@prisma/client'); const {hashPassword}=await import('../../src/lib/auth/password'); const {getStorage}=await import('../../src/lib/storage');
 const db=new PrismaClient(); const root=path.resolve(process.argv[2] ?? ''); if (!root.startsWith(path.resolve('.taskbook-working')+path.sep)) throw new Error('Ignored output required'); await mkdir(root,{recursive:false});
 const ids=[`upload-test-${randomUUID()}`,`upload-other-${randomUUID()}`]; const password=`Test-${randomUUID()}!9a`; const storage=getStorage(); const keys:string[]=[]; let token='';
 const checks:string[]=[];
 async function call(route:string,body:unknown,status=200):Promise<Record<string,unknown>> {const response=await fetch(`http://localhost:3000/api/${route}`,{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});assert.equal(response.status,status);const value=await response.json() as {data:Record<string,unknown>};return value.data;}
 async function fingerprint():Promise<string> { const rows=await db.learningContent.findMany({where:{ownerId:{notIn:ids}},orderBy:{id:'asc'},include:{owner:{select:{id:true,xpTotal:true}},notes:true,progress:true,flashcards:{include:{reviewLogs:true}},exercises:{include:{records:true}},knowledgePoints:true,studyPlans:true,generatedNote:true}});return createHash('sha256').update(JSON.stringify(rows,(_k,v:unknown):unknown=>typeof v==='bigint'?String(v):v)).digest('hex'); }
 const before=await fingerprint();
 try {
  for (const id of ids) await db.user.create({data:{id,email:`${id}@example.com`,passwordHash:await hashPassword(password),nickname:'隔离上传验收'}});
  const login=await call('auth/login',{account:`${ids[0]}@example.com`,password}); token=String(login.accessToken);
  const input={contentType:'document',fileName:'fixture.txt',fileSize:12,mimeType:'text/plain'};
  const first=await call('contents/upload-intent',input); const contentId=String(first.contentId);
  const renewed=await call('contents/upload-intent',{...input,contentId}); assert.equal(renewed.contentId,contentId); assert.equal(await db.learningContent.count({where:{ownerId:ids[0]}}),1); checks.push('same_id_one_row');
  await call('contents/upload-intent',{...input,contentId,fileSize:13},409); checks.push('wrong_file_rejected');
  const other=await call('auth/login',{account:`${ids[1]}@example.com`,password}); const ownerToken=token; token=String(other.accessToken); await call('contents/upload-intent',{...input,contentId},403); token=ownerToken; checks.push('foreign_rejected');
  const key=(await db.learningContent.findUniqueOrThrow({where:{id:contentId}})).storageKey; keys.push(key);
  assert.equal((await fetch(new URL(String(renewed.uploadUrl),'http://localhost:3000'),{method:'PUT',body:Buffer.from('hello world!'),headers:{'content-type':'text/plain'}})).status,200); assert.equal((await storage.statObject(key))?.size,12); checks.push('real_renewed_upload');
  await db.learningContent.update({where:{id:contentId},data:{updatedAt:new Date(Date.now()-10800000)}});
  const stale=await call('contents/upload-intent',{...input,fileName:'old.txt'}); const staleId=String(stale.contentId); await db.learningContent.update({where:{id:staleId},data:{updatedAt:new Date(Date.now()-10800000)}});
  const recent=await call('contents/upload-intent',{...input,fileName:'recent.txt'});
  const active=await call('contents/upload-intent',{...input,fileName:'active.txt'}); await db.learningContent.update({where:{id:String(active.contentId)},data:{updatedAt:new Date(Date.now()-10800000)}}); await db.asyncJob.create({data:{contentId:String(active.contentId),jobType:'CONTENT_PARSE',state:'RUNNING',traceId:randomUUID()}});
  const processor=path.resolve('node_modules/tsx/dist/cli.mjs');
  function maintain(mode:string,output:string,source:string):void {const result=spawnSync(process.execPath,[processor,'scripts/maintenance/stale-upload-intents.ts',mode,path.join(root,output),source],{cwd:process.cwd(),windowsHide:true,stdio:'pipe',timeout:15000}); assert.equal(result.status,0,'maintenance failed (no raw output)');}
  maintain('preview','preview',ids[0]); maintain('apply','apply',path.join(root,'preview'));
  assert.equal((await db.learningContent.findUniqueOrThrow({where:{id:staleId}})).status,'FAILED'); assert.equal((await db.learningContent.findUniqueOrThrow({where:{id:contentId}})).status,'PENDING'); assert.equal((await db.learningContent.findUniqueOrThrow({where:{id:String(recent.contentId)}})).status,'PENDING'); assert.equal((await db.learningContent.findUniqueOrThrow({where:{id:String(active.contentId)}})).status,'PENDING'); checks.push('only_expired_empty_inactive_marked');
  maintain('restore','restore',path.join(root,'apply')); assert.equal((await db.learningContent.findUniqueOrThrow({where:{id:staleId}})).status,'PENDING'); checks.push('guarded_restore');
  await db.learningContent.update({where:{id:contentId},data:{status:'READY'}}); await call('contents/upload-intent',{...input,contentId},409); checks.push('ready_rejected');
 } finally {for(const key of keys)await storage.deleteObject(key); await db.user.deleteMany({where:{id:{in:ids}}}); const unchanged=before===await fingerprint(); await writeFile(path.join(root,'report.json'),JSON.stringify({checks,passed:checks.length===7 && unchanged,originalUnchanged:unchanged,fixturesCleaned:await db.user.count({where:{id:{in:ids}}})===0,modelsCalled:false},null,2)); await db.$disconnect(); assert.ok(unchanged);}
}
main().catch(():void=>{console.error('Upload recovery acceptance failed; inspect ignored evidence, no credentials logged');process.exitCode=1;});
