import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { getStorage, type StorageClient, signStorageToken, verifyStorageToken } from '@/lib/storage';
import { authorizeAssignmentAttachment } from './access';
import { lockClass, transaction, parse, replay, record } from './service';
import { writableSubmission, assignmentMissing, assignmentConflict, lockSubmission } from './assignments';
import { attachmentStorageKey, attachmentBatchSchema, classRequestDigest, assertRevision, CLASS_LIMITS } from './rules';
import { attachmentIntentSchema, removeAttachmentSchema, type AssignmentResult } from './assignment-contracts';
import { validateAssignmentFile } from './attachment-format';
type Tx = Prisma.TransactionClient;
function unavailable(): never { throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE, '附件存储暂不可用，请保留选中文件并核对状态后重试'); }
async function attachmentIdentity(tx: Tx, id: string): Promise<Prisma.AssignmentAttachmentGetPayload<Record<string, never>>> { const file = await tx.assignmentAttachment.findUnique({ where: { id } }); if (!file) return assignmentMissing(); return file; }
function fixedKey(file: Awaited<ReturnType<typeof attachmentIdentity>>): string { const key = attachmentStorageKey(file.classroomId, file.studentId, file.id, file.mimeType); if (file.storageKey !== key) return assignmentMissing(); return key; }
export async function createAssignmentAttachment(actorId: string, submissionId: string, raw: unknown, db: PrismaClient = prisma): Promise<AssignmentResult> {
 const input = parse(attachmentIntentSchema, raw), digest = classRequestDigest('ATTACHMENT', { action: 'intent', submissionId, ...input });
 return transaction(db, async (tx): Promise<AssignmentResult> => {
  const submission = await writableSubmission(tx, actorId, submissionId);
  const old = await replay(tx, actorId, input.requestId, submission.classroomId, 'ATTACHMENT', digest); if (old) return { submissionId, resultId: old.resultId, replayed: true };
  assertRevision(submission.revision, input.expectedRevision);
  const files = await tx.assignmentAttachment.findMany({ where: { submissionId, versionId: null, state: { in: ['UPLOADING','READY'] }, expiresAt: { gt: new Date() } }, select: { fileName: true, mimeType: true, sizeBytes: true } });
  if (!attachmentBatchSchema.safeParse([...files.map((f): { fileName: string; mimeType: string; sizeBytes: number } => ({...f,sizeBytes:Number(f.sizeBytes)})), {fileName:input.fileName,mimeType:input.mimeType,sizeBytes:input.sizeBytes}]).success) throw new ApiError(ErrorCode.VALIDATION_FAILED, '最多5个草稿附件，单个20MiB、总计50MiB');
  if (await tx.assignmentAttachment.count({ where: { submissionId } }) >= 250) assignmentConflict('附件历史已达250条上限');
  const id = randomUUID(), createdAt = new Date();
  await tx.assignmentAttachment.create({ data: { id, submissionId, classroomId: submission.classroomId, studentId: actorId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, storageKey: attachmentStorageKey(submission.classroomId,actorId,id,input.mimeType), createdAt, expiresAt: new Date(createdAt.getTime()+86400000) } });
  await tx.assignmentSubmission.update({ where: { id: submissionId }, data: { revision: { increment: 1 } } }); await record(tx, actorId,input.requestId,submission.classroomId,'ATTACHMENT',digest,id);
  return { submissionId, resultId:id, replayed:false };
 });
}
async function uploadAccess(actorId: string,id:string,db:PrismaClient):Promise<Awaited<ReturnType<typeof attachmentIdentity>>> {
 return transaction(db,async(tx):Promise<Awaited<ReturnType<typeof attachmentIdentity>>>=>{ const file=await attachmentIdentity(tx,id); if(file.studentId!==actorId)return assignmentMissing(); await writableSubmission(tx,actorId,file.submissionId); await tx.$queryRaw`SELECT id FROM "AssignmentAttachment" WHERE id=${id} FOR UPDATE`; const fresh=await attachmentIdentity(tx,id); if(!['UPLOADING','READY'].includes(fresh.state)||fresh.versionId||fresh.expiresAt<=new Date())assignmentConflict('附件意图已失效或不可修改，请重新读取'); fixedKey(fresh); return fresh; });
}
export async function uploadAssignmentAttachment(actorId:string,id:string,readBytes:()=>Promise<Buffer>,db:PrismaClient=prisma,storage:StorageClient=getStorage()):Promise<AssignmentResult> {
 const file=await uploadAccess(actorId,id,db), bytes=await readBytes();
 if(bytes.length!==Number(file.sizeBytes)||bytes.length>CLASS_LIMITS.fileBytes)throw new ApiError(ErrorCode.UPLOAD_SIZE_MISMATCH,'实际附件大小与声明不一致');
 await validateAssignmentFile(bytes,file.mimeType); const digest=createHash('sha256').update(bytes).digest('hex'),key=fixedKey(file);
 if(file.state==='READY'){ if(file.sha256!==digest)assignmentConflict('该附件已经保存为其它字节，不允许覆盖'); return {submissionId:file.submissionId,resultId:id,replayed:true}; }
 try {
  if(!storage.putObjectIfAbsent)return unavailable(); const created=await storage.putObjectIfAbsent(key,bytes,file.mimeType);
  if(!created){ const object=await storage.getObject(key); let length=0;const chunks:Buffer[]=[]; try{for await(const chunk of object.stream){const b=Buffer.from(chunk as Uint8Array);length+=b.length;if(length>CLASS_LIMITS.fileBytes)assignmentConflict('已存在对象损坏，请移除该附件后重新上传');chunks.push(b);}}finally{object.stream.destroy();} if(length!==bytes.length||createHash('sha256').update(Buffer.concat(chunks)).digest('hex')!==digest)assignmentConflict('已存在对象与本次文件不同，请移除该附件后重新上传'); }
 }catch(reason){if(reason instanceof ApiError)throw reason;return unavailable();}
 return transaction(db,async(tx):Promise<AssignmentResult>=>{
  await writableSubmission(tx,actorId,file.submissionId); await tx.$queryRaw`SELECT id FROM "AssignmentAttachment" WHERE id=${id} FOR UPDATE`;const fresh=await attachmentIdentity(tx,id);
  if(fresh.state==='READY'&&fresh.sha256===digest)return {submissionId:file.submissionId,resultId:id,replayed:true};
  if(fresh.state!=='UPLOADING'||fresh.versionId||fresh.expiresAt<=new Date())assignmentConflict('附件上传期间状态发生变化，请重新读取');
  await tx.assignmentAttachment.update({where:{id},data:{state:'READY',sha256:digest}});await tx.assignmentSubmission.update({where:{id:file.submissionId},data:{revision:{increment:1}}});
  await record(tx,actorId,randomUUID(),file.classroomId,'ATTACHMENT',classRequestDigest('ATTACHMENT',{action:'complete',attachmentId:id,sha256:digest}),id);
  return {submissionId:file.submissionId,resultId:id,replayed:false};
 });
}
export async function removeAssignmentAttachment(actorId:string,id:string,raw:unknown,db:PrismaClient=prisma,storage:StorageClient=getStorage()):Promise<AssignmentResult>{
 const input=parse(removeAttachmentSchema,raw),digest=classRequestDigest('ATTACHMENT',{attachmentId:id,...input});
 const result=await transaction(db,async(tx):Promise<AssignmentResult>=>{const file=await attachmentIdentity(tx,id);if(file.studentId!==actorId)return assignmentMissing();const sub=await writableSubmission(tx,actorId,file.submissionId);const old=await replay(tx,actorId,input.requestId,file.classroomId,'ATTACHMENT',digest);if(old)return{submissionId:sub.id,resultId:id,replayed:true};assertRevision(sub.revision,input.expectedRevision);if(file.versionId||file.state==='ATTACHED')assignmentConflict('正式附件不能移除');await tx.assignmentAttachment.update({where:{id},data:{state:'DELETED'}});await tx.assignmentSubmission.update({where:{id:sub.id},data:{revision:{increment:1}}});await record(tx,actorId,input.requestId,file.classroomId,'ATTACHMENT',digest,id);return{submissionId:sub.id,resultId:id,replayed:false};});
 const file=await db.assignmentAttachment.findUniqueOrThrow({where:{id}});try{await storage.deleteObject(fixedKey(file));}catch{return unavailable();}return result;
}
export async function attachmentDownloadTicket(actorId:string,id:string,db:PrismaClient=prisma):Promise<{expires:number;sig:string;expiresInSec:number}>{
 await transaction(db,async(tx):Promise<void>=>{await authorizeAssignmentAttachment(tx,actorId,id);}); const expires=Date.now()+60000,sig=signStorageToken('get',`class-download:${actorId}:${id}`,expires);return{expires,sig,expiresInSec:60};
}
export async function downloadAssignmentAttachment(actorId:string,id:string,expires:number,sig:string,db:PrismaClient=prisma,storage:StorageClient=getStorage()):Promise<Response>{
 if(!Number.isSafeInteger(expires)||expires>Date.now()+60000||!verifyStorageToken('get',`class-download:${actorId}:${id}`,sig,expires))throw new ApiError(ErrorCode.FORBIDDEN,'附件下载地址无效或已过期');
 const allowed=await transaction(db,(tx):ReturnType<typeof authorizeAssignmentAttachment>=>authorizeAssignmentAttachment(tx,actorId,id));
 try{const object=await storage.getObject(allowed.storageKey);if(object.contentLength!==allowed.sizeBytes){object.stream.destroy();return unavailable();}const name=encodeURIComponent(allowed.fileName).replace(/[!'()*]/gu,(c):string=>'%'+c.charCodeAt(0).toString(16).toUpperCase());return new Response(Readable.toWeb(object.stream) as ReadableStream,{headers:{'Content-Type':allowed.mimeType,'Content-Length':String(allowed.sizeBytes),'Content-Disposition':`attachment; filename="assignment-file"; filename*=UTF-8''${name}`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'private, no-store'}});}catch(reason){if(reason instanceof ApiError)throw reason;return unavailable();}
}
export async function cleanupAssignmentAttachments(db:PrismaClient=prisma,storage:StorageClient=getStorage(),now=new Date(),cursor?:string):Promise<{processed:number;deleted:number;failed:number;nextCursor:string|null}>{
 const pending=await db.assignmentAttachment.findMany({where:{versionId:null,state:{in:['UPLOADING','READY','DELETED']},expiresAt:{lte:now},...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:100,select:{id:true}});let deleted=0,failed=0;
 for(const candidate of pending){const key=await transaction(db,async(tx):Promise<string|null>=>{const file=await attachmentIdentity(tx,candidate.id);await lockClass(tx,file.classroomId);await lockSubmission(tx,file.submissionId);await tx.$queryRaw`SELECT id FROM "AssignmentAttachment" WHERE id=${file.id} FOR UPDATE`;const fresh=await attachmentIdentity(tx,file.id);if(fresh.versionId||fresh.state==='ATTACHED'||fresh.expiresAt>now)return null;await tx.assignmentAttachment.update({where:{id:file.id},data:{state:'DELETED'}});return fixedKey(fresh);});if(key){try{await storage.deleteObject(key);deleted++;}catch{failed++;}}}
 return{processed:pending.length,deleted,failed,nextCursor:pending.length===100?pending.at(-1)!.id:null};
}




