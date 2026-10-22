import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { Prisma, PrismaClient } from '@prisma/client';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const sourceId = 'cmuqhyf7h00027q29tijy4uer';
const relations = { transcripts: true, textBlocks: true, knowledgePoints: true, notes: true, generatedNote: true, flashcards: { include: { reviewLogs: true } }, exercises: { include: { records: true } }, progress: true } satisfies Prisma.LearningContentInclude;
async function fingerprint(): Promise<string> {
  const data = await db.learningContent.findUniqueOrThrow({ where: { id: sourceId }, include: relations });
  return createHash('sha256').update(JSON.stringify(data, (_key: string, value: unknown): unknown => typeof value === 'bigint' ? value.toString() : value)).digest('hex');
}
async function main(): Promise<void> {
 const [mode, runId] = process.argv.slice(2);
 const reportPrefix = process.argv[4] ?? 'real-playback-20261008';
 if (!/^[a-z0-9-]{8,100}$/.test(reportPrefix)) throw new Error('Invalid report prefix');
 if (!['setup','verify','cleanup'].includes(mode) || !/^[a-z0-9-]{8,80}$/.test(runId ?? '')) throw new Error('Need setup|verify|cleanup and independent runId');
 const ownerId = `real-playback-${runId}`;
 const statePath = `.taskbook-working/${ownerId}.json`;
 try {
  if (mode === 'setup') {
   const source = await db.learningContent.findUniqueOrThrow({ where: { id: sourceId }, include: relations });
   const beforeHash = await fingerprint();
   await writeFile(statePath, JSON.stringify({ sourceId, beforeHash }), { encoding:'utf8', flag:'wx' });
   const clone = await db.learningContent.create({ data: { ownerId:source.ownerId, title:'真实旧视频 · 播放同步验收', contentType:'VIDEO', fileName:source.fileName, format:source.format, fileSizeBytes:source.fileSizeBytes, storageKey:source.storageKey, durationSec:source.durationSec, status:'READY', understandingStatus:'COMPLETED' } });
   await writeFile(statePath, JSON.stringify({ sourceId, beforeHash, cloneId:clone.id, ownerId:source.ownerId }), 'utf8');
   // Read-only shared media: cleanup deletes database fixture only, never storage objects.
   await db.transcriptSegment.createMany({ data: source.transcripts.map(row => ({ contentId:clone.id, seq:row.seq, startMs:row.startMs, endMs:row.endMs, text:row.text })) });
   await db.knowledgePoint.createMany({ data: source.knowledgePoints.map(row => ({ contentId:clone.id, ownerId:source.ownerId, title:row.title, summary:row.summary, tags:row.tags, importance:row.importance, refs:row.refs as Prisma.InputJsonValue })) });
   if (source.generatedNote) await db.generatedNote.create({ data: { contentId:clone.id, markdown:source.generatedNote.markdown, sourceCount:source.generatedNote.sourceCount } });
   console.log(JSON.stringify({ contentId:clone.id, sourceId, knowledgePoints:source.knowledgePoints.length, transcripts:source.transcripts.length, media:'original video, read-only shared object; same owner, original session preserved' }));
  } else {
   const state = JSON.parse(await readFile(statePath,'utf8')) as { beforeHash:string; cloneId:string; ownerId:string };
   if (!state.cloneId || !state.ownerId) throw new Error('Missing fixture identity');
   const notes = await db.note.findMany({ where:{contentId:state.cloneId}, select:{content:true,ref:true} });
   const progress = await db.learningProgress.findMany({ where:{contentId:state.cloneId}, select:{ref:true} });
   const sourceUnchanged = state.beforeHash === await fingerprint();
   if (mode === 'cleanup') await db.learningContent.deleteMany({ where:{id:state.cloneId,ownerId:state.ownerId} });
   const report = { recordedAt:new Date().toISOString(), mode, notes, progress, sourceUnchanged, remainingFixtureContents:await db.learningContent.count({where:{id:state.cloneId}}), sourceMediaDeleted:false };
   await writeFile(`docs/acceptance/${reportPrefix}-${mode}.json`,JSON.stringify(report,null,2),'utf8');
   console.log(JSON.stringify(report));
   if (!sourceUnchanged) process.exitCode=1;
  }
 } finally {await db.$disconnect();}
}
void main().catch(()=>{ console.error('Fixture failed; preserve shared source media and inspect local fixture state.');process.exitCode=1; });
