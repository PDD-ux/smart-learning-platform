import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth/middleware';
import { ApiError, assertOwnership } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { rateLimit } from '@/lib/api/rate-limit';
import { courseAccount } from '@/lib/courses/service';
import { bookBytes, bookDigest, extractBookUnits, initializeBook } from './source';
import { BOOK_LIMITS, bookCommandSchema, bookView, chapterId, validBookRange, validChapters, type BookCommand, type BookState } from './contracts';

const conflict=():ApiError=>new ApiError(ErrorCode.NOTE_CONFLICT,'书籍版本或源文件已变化，请保留编辑内容并重新读取；原文件改变时请重新导入。');
const invalid=(message:string):ApiError=>new ApiError(ErrorCode.VALIDATION_FAILED,message);

async function ownedBook(id:string,user:AuthUser):Promise<Prisma.LearningContentGetPayload<Record<string,never>>> {
  await courseAccount(user);
  const content=await prisma.learningContent.findUnique({where:{id}});
  if(!content)throw new ApiError(ErrorCode.CONTENT_NOT_FOUND,'资料不存在');
  assertOwnership(content.ownerId,user);
  if(content.contentType!=='DOCUMENT'||!['PDF','TXT','MD','EPUB'].includes(content.format.toUpperCase())||content.status!=='READY')throw new ApiError(ErrorCode.CONTENT_NOT_READY,'仅已就绪的PDF、TXT、Markdown或EPUB资料可建立书籍目录。');
  return content;
}
export async function readBook(request:Request,user:AuthUser,id:string):Promise<Response> {
  const content=await ownedBook(id,user),query=new URL(request.url).searchParams;
  if([...query.keys()].some((key):boolean=>!['start','end'].includes(key)||query.getAll(key).length!==1))throw invalid('阅读范围参数无效');
  if([...query.values()].some((value):boolean=>!/^\d+$/u.test(value)))throw invalid('阅读范围须为正整数');
  if(!content.bookState)return ok({book:null});
  const state=content.bookState as unknown as BookState;
  const start=query.has('start')?Number(query.get('start')):state.cursor,end=query.has('end')?Number(query.get('end')):Math.min(state.unitCount,start+19);
  if(!validBookRange(start,end,state.unitCount))throw invalid('每次最多读取20页或段，请核对范围。');
  return ok({book:bookView(state,content.bookRevision,start,end)});
}
async function commandBody(request:Request):Promise<BookCommand> {
  const reader=request.body?.getReader();if(!reader)throw invalid('请求正文不能为空');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)throw invalid('目录请求超过64KiB，请缩小内容。');chunks.push(value);}}finally{await reader.cancel().catch(():void=>undefined);reader.releaseLock();}
  let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalid('请求JSON格式无效');}
  const parsed=bookCommandSchema.safeParse(raw);if(!parsed.success)throw invalid('书籍操作字段或范围无效');return parsed.data;
}
export async function writeBook(request:Request,user:AuthUser,id:string):Promise<Response> {
  const content=await ownedBook(id,user),command=await commandBody(request);
  const digest=createHash('sha256').update(JSON.stringify(command)).digest('hex');
  const previous=content.bookState as unknown as BookState|null;
  if(previous){const replay=previous.requests.find((item):boolean=>item.id===command.requestId);if(replay){if(replay.digest!==digest)throw conflict();return ok({book:bookView(previous,content.bookRevision)});}}
  if(command.expectedRevision!==content.bookRevision)throw conflict();
  if(command.action==='initialize'&&previous)return ok({book:bookView(previous,content.bookRevision)});
  if(command.action!=='initialize'&&(!previous||command.sourceDigest!==previous.sourceDigest))throw conflict();
  const heavy=command.action==='initialize'||command.action==='extract';
  const limit=await rateLimit(`book:${heavy?'source':'state'}:${user.id}`,heavy?12:120,60000);
  if(!limit.allowed)throw new ApiError(ErrorCode.RATE_LIMITED,'书籍操作过于频繁，请稍后手动重试。');
  let state:BookState;
  try {
    if(command.action==='initialize')state=await initializeBook(await bookBytes(content.storageKey,content.fileSizeBytes),content.format.toUpperCase() as BookState['format']);
    else {
      state=structuredClone(previous!);
      if(command.action==='chapters') {
        if(!validChapters(command.chapters,state.unitCount))throw invalid('章节必须按顺序且不重叠，起止位置须在原文范围内。');
        state.chapters=command.chapters.map((chapter):BookState['chapters'][number]=>({...chapter,id:chapterId(chapter.start,chapter.end),origin:'manual'}));
      } else if(command.action==='extract') {
        if(!validBookRange(command.start,command.end,state.unitCount))throw invalid('每次最多提取20页或段，请核对范围。');
        const bytes=await bookBytes(content.storageKey,content.fileSizeBytes);if(bookDigest(bytes)!==state.sourceDigest)throw conflict();
        const units=await extractBookUnits(bytes,state,command.start,command.end);
        state.units={...state.units,...units};
        if(state.unitKind==='paragraph')state.cursor=command.start;
        if(Object.values(state.units).reduce((sum,unit):number=>sum+unit.text.length,0)>BOOK_LIMITS.storedCharacters)throw invalid('已达本资料50万字索引上限；本次未保存，仍可阅读原文件。');
      } else {
        if(command.position>state.unitCount)throw invalid('位置超出原文范围');
        if(command.action==='cursor')state.cursor=command.position;
        else if(command.action==='removeBookmark')state.bookmarks=state.bookmarks.filter((item):boolean=>item.position!==command.position);
        else {
          state.bookmarks=state.bookmarks.filter((item):boolean=>item.position!==command.position);
          if(state.bookmarks.length>=BOOK_LIMITS.bookmarks)throw invalid('每份资料最多100个书签');
          state.bookmarks.push({position:command.position,label:command.label});state.bookmarks.sort((a,b):number=>a.position-b.position);
        }
      }
    }
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(ErrorCode.CONTENT_NOT_READY,'书籍读取未完成：文件可能损坏、加密、非UTF-8、超出预算或不可访问。本次未保存，请核对原文件。');}
  state.requests=[...state.requests,{id:command.requestId,digest}].slice(-32);
  const committed=await prisma.$transaction(async(tx):Promise<{state:BookState;revision:number}>=>{
    await courseAccount(user,false,tx,true);
    const changed=await tx.learningContent.updateMany({where:{id,ownerId:user.id,status:'READY',bookRevision:command.expectedRevision},data:{bookState:state as unknown as Prisma.InputJsonValue,bookRevision:{increment:1},...(command.action==='initialize'&&content.pageCount===null?{pageCount:state.unitKind==='page'?state.unitCount:1}:{})}});
    if(changed.count!==1){
      const latest=await tx.learningContent.findFirst({where:{id,ownerId:user.id,status:'READY'}});
      const snapshot=latest?.bookState as unknown as BookState|null;
      if(latest&&snapshot?.requests.some((item):boolean=>item.id===command.requestId&&item.digest===digest))return{state:snapshot,revision:latest.bookRevision};
      throw conflict();
    }
    return{state,revision:content.bookRevision+1};
  });
  const start=command.action==='extract'?command.start:committed.state.cursor,end=command.action==='extract'?command.end:Math.min(committed.state.unitCount,start+19);
  return ok({book:bookView(committed.state,committed.revision,start,end)});
}
