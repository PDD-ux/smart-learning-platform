import { createHash } from 'node:crypto';
import type { HomeworkDraft, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { recordAudit } from '@/lib/audit/audit-service';
import { account, lockClass, transaction } from '@/lib/classrooms/service';
import { authorizeAssignmentAttachment } from '@/lib/classrooms/access';
import { getStorage, type StorageClient } from '@/lib/storage';
import { boundedText, extractHomeworkFile, type ExtractedHomework } from './extract';
import { FILE_LIMIT, createHomeworkSchema, homeworkCommandSchema, completeQuestions, type CreateHomework, type HomeworkSource, type HomeworkView, type HomeworkQuestion, type HomeworkList } from './contracts';
type Tx=Prisma.TransactionClient;
type Operation={id:string;digest:string};
function parse<T>(schema:{safeParse:(input:unknown)=>{success:true;data:T}|{success:false}},input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw new ApiError(ErrorCode.VALIDATION_FAILED,'作业校对字段不合法，请核对输入、题号和长度限制');return result.data;}
const hash=(value:string|Buffer):string=>createHash('sha256').update(value).digest('hex');
function missing():never{throw new ApiError(ErrorCode.NOT_FOUND,'作业校对记录不存在或不可访问');}
function conflict(message='记录已变化，请保留输入并重新读取'):never{throw new ApiError(ErrorCode.CLASSROOM_CONFLICT,message);}
async function student(tx:Tx,actorId:string):Promise<void>{if((await account(tx,actorId,true)).role!=='student')missing();}
function view(row:HomeworkDraft):HomeworkView{return{id:row.id,title:row.title,revision:row.revision,state:row.state,source:row.source as unknown as HomeworkSource,rawText:row.rawText,issues:row.issues as string[],questions:row.questions as unknown as HomeworkQuestion[],createdAt:row.createdAt.toISOString()};}
async function owned(tx:Tx,actorId:string,id:string):Promise<HomeworkDraft>{await student(tx,actorId);await tx.$queryRaw`SELECT id FROM "HomeworkDraft" WHERE id=${id} FOR UPDATE`;const row=await tx.homeworkDraft.findUnique({where:{id}});if(!row||row.ownerId!==actorId)missing();if(row.state==='PROCESSING'&&row.leaseExpiresAt&&row.leaseExpiresAt<=new Date())return tx.homeworkDraft.update({where:{id},data:{state:'FAILED',leaseExpiresAt:null,revision:{increment:1},issues:['识别等待已超过90秒；未自动重试。可手动补录或明确新建一次识别。']}});return row;}
type Prepared={source:HomeworkSource;text?:string;bytes?:Buffer;fileName?:string;mimeType?:string};
async function prepare(tx:Tx,actorId:string,input:CreateHomework):Promise<Prepared>{
 const source=input.source;
 if(source.kind==='text')return{source:{kind:'text',label:'本人粘贴的作业文字',method:'manual',sha256:hash(source.text)},text:source.text};
 if(source.kind==='file'){const bytes=Buffer.from(source.base64,'base64');if(bytes.length>FILE_LIMIT||bytes.toString('base64')!==source.base64)throw new ApiError(ErrorCode.VALIDATION_FAILED,'文件超过4MiB或编码不合法');return{source:{kind:'file',label:source.fileName,fileName:source.fileName,mimeType:source.mimeType,sizeBytes:bytes.length,sha256:hash(bytes)},bytes,fileName:source.fileName,mimeType:source.mimeType};}
 const version=await tx.submissionVersion.findUnique({where:{id:source.versionId},include:{submission:true}});if(!version||version.studentId!==actorId)missing();await lockClass(tx,version.classroomId,false);
 const snapshot:HomeworkSource={kind:'submission',label:`${version.assignmentTitle} · 第${version.versionNo}版`,versionId:version.id,method:'submission-body',sha256:hash(version.bodyText)};
 if(!source.attachmentId)return{source:snapshot,text:version.bodyText};
 const file=await tx.assignmentAttachment.findUnique({where:{id:source.attachmentId}});if(!file||file.versionId!==version.id||file.studentId!==actorId)missing();await authorizeAssignmentAttachment(tx,actorId,file.id);if(Number(file.sizeBytes)>FILE_LIMIT)throw new ApiError(ErrorCode.VALIDATION_FAILED,'本次识别附件最多4MiB，请自行拆分或选择本版正文');
 return{source:{...snapshot,attachmentId:file.id,fileName:file.fileName,mimeType:file.mimeType,sizeBytes:Number(file.sizeBytes),sha256:file.sha256??undefined},fileName:file.fileName,mimeType:file.mimeType};
}
async function submissionBytes(actorId:string,input:CreateHomework,db:PrismaClient,storage:StorageClient):Promise<Buffer>{
 if(input.source.kind!=='submission'||!input.source.attachmentId)throw Error('attachment required');const id=input.source.attachmentId;
 const allowed=await transaction(db,async(tx):Promise<Awaited<ReturnType<typeof authorizeAssignmentAttachment>>>=>{await student(tx,actorId);return authorizeAssignmentAttachment(tx,actorId,id);});
 const object=await storage.getObject(allowed.storageKey),parts:Buffer[]=[];let length=0;
 try{for await(const part of object.stream){const bytes=Buffer.from(part as Uint8Array);length+=bytes.length;if(length>FILE_LIMIT)throw Error('file budget');parts.push(bytes);}}finally{object.stream.destroy();}if(length!==allowed.sizeBytes)throw Error('size mismatch');return Buffer.concat(parts);
}
export async function createHomework(actorId:string,raw:unknown,db:PrismaClient=prisma,storage:StorageClient=getStorage(),extract=extractHomeworkFile):Promise<HomeworkView>{
 const input=parse(createHomeworkSchema,raw),digest=hash(JSON.stringify(input));
 const reserved=await transaction(db,async(tx):Promise<{row:HomeworkDraft;prepared?:Prepared}>=>{await student(tx,actorId);const old=await tx.homeworkDraft.findUnique({where:{id:input.id}});if(old){if(old.ownerId!==actorId)missing();if(old.createDigest!==digest)conflict('该识别编号已用于其它输入');return{row:await owned(tx,actorId,input.id)};}if(await tx.homeworkDraft.count({where:{ownerId:actorId}})>=100)conflict('本人作业识别记录已达100条上限');const prepared=await prepare(tx,actorId,input);const row=await tx.homeworkDraft.create({data:{id:input.id,ownerId:actorId,title:input.title,createDigest:digest,source:prepared.source as unknown as Prisma.InputJsonValue,leaseExpiresAt:new Date(Date.now()+90000)}});await recordAudit({actorId,objectId:row.id,action:'homework.create'},tx);return{row,prepared};});
 if(!reserved.prepared)return view(reserved.row);
 let extracted:ExtractedHomework|{text:string;issues:string[];method:'manual'|'submission-body'}|null=null;let failure='';const prepared=reserved.prepared;
 try{if(prepared.text!==undefined)extracted={text:boundedText(prepared.text),issues:['这是本人输入或本人提交快照；请逐题核对，系统未推断题目与答案。'],method:prepared.source.kind==='text'?'manual':'submission-body'};else{const bytes=prepared.bytes??await submissionBytes(actorId,input,db,storage);if(prepared.source.sha256&&hash(bytes)!==prepared.source.sha256)throw Error('source digest mismatch');extracted=await extract(bytes,prepared.fileName!,prepared.mimeType!);}}catch(reason){failure=reason instanceof ApiError?reason.message:'作业提取未完成，原件未修改；请手工补录或新建一次识别。';}
 return transaction(db,async(tx):Promise<HomeworkView>=>{const current=await owned(tx,actorId,input.id);if(current.state!=='PROCESSING')return view(current);if(input.source.kind==='submission')await prepare(tx,actorId,input);const row=await tx.homeworkDraft.update({where:{id:input.id},data:{state:extracted?'DRAFT':'FAILED',revision:{increment:1},leaseExpiresAt:null,rawText:extracted?.text??'',issues:extracted?.issues??[failure],source:{...prepared.source,...(extracted?{method:extracted.method}:{})} as unknown as Prisma.InputJsonValue}});await recordAudit({actorId,objectId:row.id,action:extracted?'homework.extracted':'homework.extraction_failed'},tx);return view(row);});
}
export async function readHomework(actorId:string,id:string,db:PrismaClient=prisma):Promise<HomeworkView>{return transaction(db,async(tx):Promise<HomeworkView>=>view(await owned(tx,actorId,id)));}
export async function listHomework(actorId:string,page=1,db:PrismaClient=prisma):Promise<HomeworkList>{return transaction(db,async(tx):Promise<HomeworkList>=>{await student(tx,actorId);const rows=await tx.homeworkDraft.findMany({where:{ownerId:actorId,state:{not:'ARCHIVED'}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:21,select:{id:true,title:true,state:true,createdAt:true}});return{items:rows.slice(0,20).map((row):HomeworkList['items'][number]=>({...row,createdAt:row.createdAt.toISOString()})),page,hasMore:rows.length>20};});}
export async function commandHomework(actorId:string,id:string,raw:unknown,db:PrismaClient=prisma):Promise<HomeworkView>{const input=parse(homeworkCommandSchema,raw),digest=hash(JSON.stringify({id,...input}));return transaction(db,async(tx):Promise<HomeworkView>=>{const row=await owned(tx,actorId,id),operations=row.operations as unknown as Operation[];const old=operations.find((op):boolean=>op.id===input.requestId);if(old){if(old.digest!==digest)conflict('该请求编号已用于其它内容');return view(row);}if(row.revision!==input.expectedRevision)conflict();if(row.state==='PROCESSING'||row.state==='ARCHIVED'||(row.state==='CONFIRMED'&&input.action!=='archive'))conflict('当前状态不可修改；已确认内容保持冻结');if(operations.length>=100)conflict('本记录已达100次修改上限');if(input.action==='confirm'&&!completeQuestions(row.questions as unknown as HomeworkQuestion[]))throw new ApiError(ErrorCode.VALIDATION_FAILED,'请补齐每题题号、题目、答案和参考答案或评分依据，并逐题勾选核对');
 const updated=await tx.homeworkDraft.update({where:{id},data:{state:input.action==='archive'?'ARCHIVED':input.action==='confirm'?'CONFIRMED':'DRAFT',...(input.action==='save'?{questions:input.questions as unknown as Prisma.InputJsonValue}:{}),revision:{increment:1},operations:[...operations,{id:input.requestId,digest}] as unknown as Prisma.InputJsonValue}});await recordAudit({actorId,objectId:id,action:'homework.'+input.action},tx);return view(updated);});}
