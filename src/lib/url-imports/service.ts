import { createHash } from 'node:crypto';
import { Prisma, type UrlImportDraft } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { courseAccount } from '@/lib/courses/service';
import { getStorage } from '@/lib/storage';
import { fetchPublicDocument, normalizedPublicUrl, UrlImportError } from './fetch';
import { prepareUrl, type PreparedUrl } from './prepare';
import type { UrlDraftView } from './contracts';

const conflict = (): ApiError => new ApiError(ErrorCode.NOTE_CONFLICT,'链接预览状态已变化，请重新读取核对；已保存资料不会被取消或覆盖。');
const invalid = (message: string): ApiError => new ApiError(ErrorCode.VALIDATION_FAILED,message);
const failures: Record<string,string> = { ADDRESS_BLOCKED:'链接地址未通过公开网络校验；不支持本机、内网、元数据、带凭据或特殊端口地址。', FETCH_FAILED:'无法获取公开内容，请核对地址与访问权限；登录、网盘和动态页面请改用文件上传。', TOO_LARGE:'内容超过本次预览预算，请下载本人有权使用的文件后上传。', UNSUPPORTED_TYPE:'仅支持公开静态HTML文章和直接PDF；不支持视频播放页、压缩响应或其它文件。', CONTENT_UNREADABLE:'未找到可靠静态正文，或文件无法安全解析；请改用文件上传。', CANCELLED:'本次预览已取消。', TIMEOUT:'公开内容获取超时，请稍后手动重新预览。' };
const metadataSelect = { id:true,ownerId:true,requestId:true,requestDigest:true,state:true,requestedUrl:true,prepared:true,errorCode:true,contentId:true,expiresAt:true,createdAt:true,updatedAt:true } as const;
Object.assign(failures, { VIDEO_ADDRESS_BLOCKED:'视频地址未通过公开网络校验；若开启代理，请检查Fake-IP DNS模式。内网、元数据和保留地址不可导入。', VIDEO_FETCH_FAILED:'视频获取或保存未完成，请重读状态；也可下载有权使用的文件后上传。', VIDEO_TOO_LARGE:'视频超过100MB下载上限，请改用文件上传。', VIDEO_UNSUPPORTED_TYPE:'请使用直接返回MP4/WebM文件的链接；不支持播放网页、HLS、网盘或压缩响应。', VIDEO_CONTENT_UNREADABLE:'视频无法通过媒体校验：需要本机ffprobe、有效时长（最长2小时）及H.264 MP4或VP8/VP9/AV1 WebM。', VIDEO_CANCELLED:'本次视频导入已取消。', VIDEO_TIMEOUT:'视频下载超过120秒，请改用文件上传。', VIDEO_QUEUE_FAILED:'视频已保存，解析队列暂不可用，请在学习中心重试解析。' });
const expiry = (): Date => new Date(Date.now()+30*60*1000);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
function key(draft: Pick<UrlImportDraft,'id'>, format: 'MD'|'PDF'|'MP4'|'WEBM'): string { return 'contents/url-'+draft.id+'/source.'+format.toLowerCase(); }
export async function smallBody(request: Request): Promise<unknown> {
  const reader=request.body?.getReader();if(!reader)throw invalid('请求正文不能为空');const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4096)throw invalid('请求正文超过4KiB');chunks.push(value);}}finally{await reader.cancel().catch(():void=>undefined);reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalid('请求JSON格式无效');}
}
export function requestId(value: string): string {if(!z.string().uuid().safeParse(value).success)throw invalid('预览编号无效');return value;}
async function lockOwner(tx: Prisma.TransactionClient,userId: string): Promise<void> {
  const rows=await tx.$queryRawUnsafe<Array<{id:string}>>('SELECT id FROM "User" WHERE id = $1 FOR UPDATE',userId);
  if(!rows.length)throw new ApiError(ErrorCode.UNAUTHENTICATED,'账号已失效，请重新登录');
}
async function orphanCleanup(tx: Prisma.TransactionClient,draft: UrlImportDraft): Promise<void> {
  if(await tx.learningContent.findUnique({where:{id:'url-'+draft.id},select:{id:true}}))return;
  for(const format of ['MD','PDF','MP4','WEBM'] as const)await getStorage().deleteObject(key(draft,format));
}
/** Expiry is opportunistic plus a bounded maintenance CLI, not an installed timer. */
export async function expireUrlDrafts(ownerId?: string): Promise<number> {
  const rows=await prisma.urlImportDraft.findMany({where:{...(ownerId?{ownerId}:{}),expiresAt:{lt:new Date()},state:{in:['FETCHING','PREVIEW','FAILED']}},orderBy:{expiresAt:'asc'},take:ownerId?10:100,select:metadataSelect});let count=0;
  for(const row of rows)await prisma.$transaction(async(tx):Promise<void>=>{
    await lockOwner(tx,row.ownerId);const metadata=await tx.urlImportDraft.findUnique({where:{id:row.id},select:metadataSelect});const current=metadata?{...metadata,snapshot:null}:null;if(!current||current.state==='COMMITTED'||current.expiresAt>new Date())return;
    await orphanCleanup(tx,current);
    await tx.urlImportDraft.update({where:{id:row.id},data:{state:'EXPIRED',snapshot:null,prepared:Prisma.DbNull,requestedUrl:'',errorCode:null}});count++;
  },{timeout:45000});return count;
}
async function owned(user: AuthUser,id: string): Promise<UrlImportDraft> {
  await courseAccount(user);requestId(id);const row=await prisma.urlImportDraft.findUnique({where:{ownerId_requestId:{ownerId:user.id,requestId:id}},select:metadataSelect});if(!row)throw new ApiError(ErrorCode.NOT_FOUND,'预览不存在或不属于当前账号');return {...row,snapshot:null};
}
async function view(row: UrlImportDraft): Promise<UrlDraftView> {
  const prepared=row.prepared as unknown as PreparedUrl|null;
  const existing=prepared&&row.state==='PREVIEW'?await prisma.learningContent.findMany({where:{ownerId:row.ownerId,AND:[{urlSource:{path:['requestedUrl'],equals:prepared.source.requestedUrl}},{urlSource:{path:['contentDigest'],equals:prepared.source.contentDigest}}]},orderBy:{createdAt:'desc'},take:5,select:{id:true,title:true,status:true}}):[];
  return{requestId:row.requestId,state:row.state as UrlDraftView['state'],expiresAt:row.expiresAt.toISOString(),error:row.errorCode?failures[row.errorCode]??failures.FETCH_FAILED:null,contentId:row.contentId,preview:prepared&&row.state==='PREVIEW'?{format:prepared.format,source:prepared.source,excerpt:prepared.excerpt,previewRange:prepared.previewRange,characters:prepared.characters,units:prepared.bookState.unitCount,chapters:prepared.bookState.chapters.length}:null,existing:existing.map((item):UrlDraftView['existing'][number]=>({contentId:item.id,title:item.title,status:item.status}))};
}
export async function readUrlDraft(user: AuthUser,id: string): Promise<UrlDraftView> {await courseAccount(user);await expireUrlDrafts(user.id);return view(await owned(user,id));}
export async function previewUrl(request: Request,user: AuthUser): Promise<UrlDraftView> {
  await courseAccount(user);await expireUrlDrafts(user.id);
  const parsed=z.object({requestId:z.string().uuid(),url:z.string().trim().min(1).max(2048)}).strict().safeParse(await smallBody(request));if(!parsed.success)throw invalid('请输入公开文章或直接PDF的完整HTTP(S)链接');
  let url: string;try{url=normalizedPublicUrl(parsed.data.url).href;}catch(error){throw invalid(error instanceof UrlImportError?failures[error.reason]:failures.ADDRESS_BLOCKED);}
  const digest=createHash('sha256').update(url).digest('hex');
  const reservation=await prisma.$transaction(async(tx):Promise<{row:UrlImportDraft;created:boolean}>=>{
    await lockOwner(tx,user.id);const previous=await tx.urlImportDraft.findUnique({where:{ownerId_requestId:{ownerId:user.id,requestId:parsed.data.requestId}}});if(previous){if(previous.requestDigest!==digest)throw conflict();return{row:previous,created:false};}
    if(request.signal.aborted)throw invalid(failures.CANCELLED);
    if(await tx.urlImportDraft.count({where:{ownerId:user.id,state:{in:['FETCHING','PREVIEW']},expiresAt:{gt:new Date()}}})>=3)throw invalid('最多保留3份待确认预览，请先保存或取消。');
    if(!(await rateLimit('url-preview:'+user.id,6,60000)).allowed)throw new ApiError(ErrorCode.RATE_LIMITED,'本分钟链接预览次数已达上限，请稍后再试');
    return{row:await tx.urlImportDraft.create({data:{ownerId:user.id,requestId:parsed.data.requestId,requestDigest:digest,requestedUrl:url,expiresAt:expiry()}}),created:true};
  });
  if(!reservation.created)return view(reservation.row);
  try{
    const download=await fetchPublicDocument(url,request.signal),prepared=await prepareUrl(download,url);
    if(request.signal.aborted)throw new UrlImportError('CANCELLED');
    await prisma.urlImportDraft.updateMany({where:{id:reservation.row.id,state:'FETCHING',expiresAt:{gt:new Date()}},data:{state:'PREVIEW',prepared:json(prepared.prepared),snapshot:prepared.bytes,errorCode:null}});
  }catch(error:unknown){const code=error instanceof UrlImportError?error.reason:'CONTENT_UNREADABLE';await prisma.urlImportDraft.updateMany({where:{id:reservation.row.id,state:'FETCHING'},data:{state:code==='CANCELLED'?'CANCELLED':'FAILED',snapshot:null,prepared:Prisma.DbNull,requestedUrl:'',errorCode:code}});}
  return view(await owned(user,parsed.data.requestId));
}
export async function cancelUrlDraft(user: AuthUser,id: string): Promise<UrlDraftView> {
  const row=await owned(user,id);
  const result=await prisma.$transaction(async(tx):Promise<UrlImportDraft>=>{await lockOwner(tx,user.id);const current=await tx.urlImportDraft.findUniqueOrThrow({where:{id:row.id}});if(current.state==='COMMITTED')throw conflict();await orphanCleanup(tx,current);return tx.urlImportDraft.update({where:{id:row.id},data:{state:'CANCELLED',snapshot:null,prepared:Prisma.DbNull,requestedUrl:'',errorCode:'CANCELLED'}});},{timeout:45000});return view(result);
}
export async function confirmUrlDraft(request: Request,user: AuthUser,id: string): Promise<UrlDraftView> {
  const row=await owned(user,id),parsed=z.object({confirmed:z.literal(true),mode:z.enum(['reuse','new'])}).strict().safeParse(await smallBody(request));if(!parsed.success)throw invalid('请核对预览后明确选择复用资料或另存版本');
  try{
    const result=await prisma.$transaction(async(tx):Promise<UrlImportDraft>=>{
      await lockOwner(tx,user.id);const current=await tx.urlImportDraft.findUniqueOrThrow({where:{id:row.id}});
      if(current.state==='COMMITTED'){if(!current.contentId)throw conflict();return current;}
      if(current.state!=='PREVIEW'||!current.snapshot||!current.prepared||current.expiresAt<new Date())throw conflict();
      if(request.signal.aborted)throw invalid(failures.CANCELLED);
      const prepared=current.prepared as unknown as PreparedUrl,bytes=Buffer.from(current.snapshot);
      if(createHash('sha256').update(bytes).digest('hex')!==prepared.source.contentDigest)throw conflict();
      const prior=await tx.learningContent.findMany({where:{ownerId:user.id,urlSource:{path:['requestedUrl'],equals:prepared.source.requestedUrl}},orderBy:{createdAt:'desc'},select:{id:true,urlSource:true},take:1});
      const duplicate=await tx.learningContent.findFirst({where:{ownerId:user.id,AND:[{urlSource:{path:['requestedUrl'],equals:prepared.source.requestedUrl}},{urlSource:{path:['contentDigest'],equals:prepared.source.contentDigest}}]},orderBy:{createdAt:'desc'},select:{id:true}});
      let contentId=parsed.data.mode==='reuse'?duplicate?.id:undefined;
      if(!contentId){
        contentId='url-'+current.id;const storageKey=key(current,prepared.format);
        await getStorage().putObject(storageKey,bytes,{contentType:prepared.format==='PDF'?'application/pdf':'text/markdown; charset=utf-8'});
        if(request.signal.aborted)throw invalid(failures.CANCELLED);
        await tx.learningContent.create({data:{id:contentId,ownerId:user.id,contentType:'DOCUMENT',title:prepared.source.title.slice(0,100),fileName:'source.'+prepared.format.toLowerCase(),format:prepared.format,fileSizeBytes:BigInt(bytes.length),storageKey,status:'READY',pageCount:prepared.format==='PDF'?prepared.bookState.unitCount:1,understandingStatus:'NONE',bookState:json(prepared.bookState),bookRevision:1,urlSource:json({...prepared.source,previousContentId:prior[0]?.id??null})}});
      }
      return tx.urlImportDraft.update({where:{id:current.id},data:{state:'COMMITTED',contentId,snapshot:null,prepared:Prisma.DbNull,requestedUrl:'',errorCode:null}});
    },{maxWait:15000,timeout:45000});return view(result);
  }catch(error:unknown){
    // Owner serialization prevents compensation deleting a successful retry's object.
    await prisma.$transaction(async(tx):Promise<void>=>{await lockOwner(tx,user.id);const current=await tx.urlImportDraft.findUnique({where:{id:row.id}});if(current&&current.state!=='COMMITTED')await orphanCleanup(tx,current);},{timeout:45000}).catch(():void=>undefined);
    if(error instanceof ApiError)throw error;throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE,'快照暂未保存，请重新读取预览状态后手动重试；已有资料保持。');
  }
}
