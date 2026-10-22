import type {LearningContent,Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {getStorage} from '@/lib/storage';
import {courseAccount} from '@/lib/courses/service';
import {rateLimit} from '@/lib/api/rate-limit';
import {ApiError} from '@/lib/auth/ownership';
import {ErrorCode} from '@/lib/api/errors';
import type {AuthUser} from '@/lib/auth/middleware';
import type {BookState} from '@/lib/books/contracts';
import {PASTE_LIMITS,pasteCommandSchema,publicPasteSource,type PasteCommand,type PasteResult,type StoredPasteSource} from './contracts';
import {preparePaste,pasteHash,pasteInvalid,pasteConflict} from './prepare';
async function body(request:Request):Promise<PasteCommand>{const reader=request.body?.getReader();if(!reader)throw pasteInvalid('请求正文不能为空');const chunks:Uint8Array[]=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>PASTE_LIMITS.requestBytes)throw pasteInvalid('请求超过512KiB，请缩小正文。');chunks.push(value);}}finally{await reader.cancel().catch(():void=>undefined);reader.releaseLock();}let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw pasteInvalid('请求JSON无效');}const parsed=pasteCommandSchema.safeParse(raw);if(!parsed.success)throw pasteInvalid('请填写标题、来源说明和20–100000字正文；作者未知可留空。');return parsed.data;}
export async function importText(request:Request,user:AuthUser):Promise<PasteResult>{await courseAccount(user);const command=await body(request);
 if(command.action==='preview'&&!(await rateLimit('paste:preview:'+user.id,12,60000)).allowed)throw new ApiError(ErrorCode.RATE_LIMITED,'正文导入过于频繁，请稍后手动重试');
 const prepared=await preparePaste(command);if(command.action==='preview')return{preview:prepared.preview};if(command.previewDigest!==prepared.preview.previewDigest)throw pasteConflict();
 const id='paste-'+pasteHash(user.id).slice(0,24)+'-'+command.requestId,key='contents/'+id+'/source.txt',digest=pasteHash(JSON.stringify(command));let write:Promise<void>|null=null;
 try{
 const row=await prisma.$transaction(async(tx):Promise<LearningContent>=>{
  await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',user.id);await courseAccount(user,false,tx);
  const existing=await tx.learningContent.findUnique({where:{id}});
  if(existing){const origin=(existing.bookState as unknown as BookState|null)?.pastedSource;if(existing.ownerId!==user.id)throw new ApiError(ErrorCode.NOT_FOUND,'导入结果不存在');if(!origin||origin.inputDigest!==digest||existing.storageKey!==key)throw pasteConflict();return existing;}
  if(await tx.auditLog.findFirst({where:{actorId:user.id,objectId:id,action:'text-import.confirm'},select:{id:true}}))throw new ApiError(ErrorCode.NOTE_CONFLICT,'这份导入资料已移除，请重新预览并以新请求保存，不复用旧引用。');
  if(!(await rateLimit('paste:confirm:'+user.id,6,60000)).allowed)throw new ApiError(ErrorCode.RATE_LIMITED,'正文保存过于频繁，请稍后手动重试');
  if(request.signal.aborted)throw pasteInvalid('本次保存已取消，正文未创建');
  const source:StoredPasteSource={version:1,kind:'PASTE',label:prepared.input.sourceLabel,author:prepared.input.author||null,importedAt:new Date().toISOString(),bodyDigest:prepared.preview.bodyDigest,requestId:command.requestId,inputDigest:digest};prepared.book.pastedSource=source;
  write=getStorage().putObject(key,prepared.bytes,{contentType:'text/plain; charset=utf-8'});await write;
  if(request.signal.aborted)throw pasteInvalid('本次保存已取消，请核对后重试');
  const content=await tx.learningContent.create({data:{id,ownerId:user.id,contentType:'DOCUMENT',format:'TXT',title:prepared.input.title,fileName:'pasted-source.txt',storageKey:key,fileSizeBytes:BigInt(prepared.bytes.length),status:'READY',understandingStatus:'NONE',pageCount:1,bookState:prepared.book as unknown as Prisma.InputJsonValue,bookRevision:1}});
  await tx.auditLog.create({data:{actorId:user.id,objectId:id,action:'text-import.confirm',result:'success',detail:JSON.stringify({digest})}});return content;
 },{timeout:30000,maxWait:15000});
 return{contentId:row.id,source:publicPasteSource((row.bookState as unknown as BookState).pastedSource!)};
 }catch(error:unknown){
  // Settle an in-flight object write before compensating; serialize with successful retries.
  if(write){await Promise.resolve(write).catch(():void=>undefined);await prisma.$transaction(async(tx):Promise<void>=>{await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',user.id);if(!await tx.learningContent.findFirst({where:{id,storageKey:key},select:{id:true}}))await getStorage().deleteObject(key);},{timeout:30000,maxWait:15000}).catch(():void=>undefined);}
  if(error instanceof ApiError)throw error;throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE,'正文尚未确认保存，请保留输入并用原请求重试；已有资料不受影响。');
 }
}
