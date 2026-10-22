/** Explicit preview/apply only; never deletes content or storage objects. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), true);
const mode=process.argv[2];
const directory=path.resolve(process.argv[3] ?? '');
if (!['preview','apply','restore'].includes(mode) || !directory.startsWith(path.resolve('.taskbook-working')+path.sep)) throw new Error('Use preview|apply and a fresh ignored output directory');
async function main(): Promise<void> {
  const { PrismaClient }=await import('@prisma/client');
  const { getStorage }=await import('../../src/lib/storage');
  const db=new PrismaClient();
  try {
    await mkdir(directory,{recursive:false});
    const baseSchema=z.array(z.object({id:z.string().min(1),ownerId:z.string().min(1),updatedAt:z.string().datetime(),storageKey:z.string(),status:z.string(),failReason:z.string().nullable()}));
    const source=process.argv[4] ? path.resolve(process.argv[4]) : null;
    if (mode === 'restore') {
      if (!source || !source.startsWith(path.resolve('.taskbook-working')+path.sep)) throw new Error('Backup path required');
      const originals=baseSchema.parse(JSON.parse(await readFile(path.join(source,'backup.json'),'utf8')));
      const changes=z.array(z.object({id:z.string(),updatedAt:z.string().datetime()})).parse(JSON.parse(await readFile(path.join(source,'changes.json'),'utf8')));
      const restored:string[]=[];
      for (const row of originals) {
        const change=changes.find((value):boolean=>value.id===row.id); if (!change) continue;
        const result=await db.learningContent.updateMany({where:{id:row.id,ownerId:row.ownerId,storageKey:row.storageKey,status:'FAILED',failReason:'UPLOAD_NOT_COMPLETED',updatedAt:new Date(change.updatedAt),asyncJobs:{none:{}}},data:{status:'PENDING',failReason:row.failReason}});
        if (result.count===1) restored.push(row.id);
      }
      await writeFile(path.join(directory,'report.json'),JSON.stringify({mode,restoredIds:restored,deletedRecords:0,deletedObjects:0},null,2));
      console.log(JSON.stringify({restoredCount:restored.length})); return;
    }
    const approved=mode === 'apply' ? (source && source.startsWith(path.resolve('.taskbook-working')+path.sep) ? baseSchema.parse(JSON.parse(await readFile(path.join(source,'backup.json'),'utf8'))) : (()=>{throw new Error('Preview required');})()) : null;
    const scope=mode === 'preview' && process.argv[4] ? {ownerId:process.argv[4]} : approved ? {id:{in:approved.map((row):string=>row.id)}} : {};
    const ttl=Number(process.env.S3_PRESIGNED_EXPIRES ?? 3600);
    if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('Invalid upload lifetime');
    const cutoff=new Date(Date.now()-Math.max(7200,ttl*2)*1000);
    const where={...scope,status:'PENDING' as const,understandingStatus:'NONE' as const,updatedAt:{lt:cutoff},asyncJobs:{none:{}},notes:{none:{}},progress:{none:{}},knowledgePoints:{none:{}},flashcards:{none:{}},exercises:{none:{}},textBlocks:{none:{}},transcripts:{none:{}},studyPlans:{none:{}},generatedNote:{is:null}};
    const all=await db.learningContent.findMany({where:{...scope,status:'PENDING'},orderBy:{id:'asc'},select:{id:true,createdAt:true,updatedAt:true}});
    const eligible=await db.learningContent.findMany({where,orderBy:{id:'asc'}});
    const storage=getStorage();
    const missing=[];
    for (const row of eligible) if ((!approved || approved.some((previous):boolean=>previous.id===row.id && previous.ownerId===row.ownerId && previous.updatedAt===row.updatedAt.toISOString() && previous.storageKey===row.storageKey)) && !await storage.statObject(row.storageKey)) missing.push(row);
    await writeFile(path.join(directory,'backup.json'),JSON.stringify(missing,(_key,value:unknown):unknown=>typeof value==='bigint'?String(value):value,2),{flag:'wx'});
    const marked:string[]=[];
    if (mode === 'apply') {
      for (const row of missing) {
        if (await storage.statObject(row.storageKey)) continue;
        const changed=await db.learningContent.updateMany({where:{...where,id:row.id,ownerId:row.ownerId,updatedAt:row.updatedAt,storageKey:row.storageKey},data:{status:'FAILED',failReason:'UPLOAD_NOT_COMPLETED'}});
        if (changed.count===1) marked.push(row.id);
      }
    }
    if (mode === 'apply') await writeFile(path.join(directory,'changes.json'),JSON.stringify(await db.learningContent.findMany({where:{id:{in:marked}},select:{id:true,updatedAt:true}}),null,2));
    const report={mode,checkedAt:new Date().toISOString(),cutoff:cutoff.toISOString(),pendingCount:all.length,eligibleEmptyCount:missing.length,markedIds:marked,deletedRecords:0,deletedObjects:0,retainedIds:missing.map((row):string=>row.id),newOrActiveNotTouched:true};
    await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
    console.log(JSON.stringify({pendingCount:all.length,eligibleEmptyCount:missing.length,markedCount:marked.length,deletedRecords:0,deletedObjects:0}));
  } finally { await db.$disconnect(); }
}
main().catch(():void=>{console.error('Residual audit did not complete; inspect configuration (no raw errors or credentials)');process.exitCode=1;});
