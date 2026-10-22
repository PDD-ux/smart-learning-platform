import {publicPasteSource} from '@/lib/text-imports/contracts';
import type {Prisma} from '@prisma/client';
import type {AuthUser} from '@/lib/auth/middleware';
import {ApiError} from '@/lib/auth/ownership';
import {ErrorCode} from '@/lib/api/errors';
import {prisma} from '@/lib/prisma';
import type {BookState} from '@/lib/books/contracts';
import {contentRefSchema,isRefInRange} from '@/lib/domain/content-ref';
import type {ContentRef} from '@/lib/domain/content-ref';
import {TOPIC_LIMITS,type TopicScope,type TopicPreview,type SourceCoverage,type TopicEvidence} from './contracts';
import {topicDigest,windows,retrieve} from './evidence';
export const topicInvalid=(message:string):ApiError=>new ApiError(ErrorCode.VALIDATION_FAILED,message);
export const topicConflict=():ApiError=>new ApiError(ErrorCode.NOTE_CONFLICT,'专题或来源已变化，请保留输入，重新预览并确认。');
export async function topicPreview(sources:TopicScope[],question:string,revision:number,user:AuthUser,db:Prisma.TransactionClient=prisma):Promise<TopicPreview>{
 const coverage:SourceCoverage[]=[],all:TopicEvidence[]=[];let characters=0;
 for(const scope of sources){
  const row=await db.learningContent.findFirst({where:{id:scope.contentId,ownerId:user.id,status:'READY'}});if(!row)throw new ApiError(ErrorCode.NOT_FOUND,'所选来源不存在或当前不可用，请核对专题资料。');
  const book=row.bookState as unknown as BookState|null;
  const kind=book?.unitKind??(row.contentType==='VIDEO'?'second':'page');
  if(scope.mode==='range'&&(scope.end<scope.start||(book?(scope.start<1||scope.end>book.unitCount||scope.end-scope.start>=20):row.contentType==='VIDEO'?(scope.end-scope.start>600||row.durationSec===null||scope.end>row.durationSec):true)))throw topicInvalid('书籍范围为1–20页/段；视频范围为最多600秒，且须在原资料内。');
  const units:{text:string;ref:ContentRef}[]=[];let total:number|null=null;
  if(book){const start=scope.mode==='range'?scope.start:1,end=scope.mode==='range'?scope.end:book.unitCount;total=end-start+1;for(let position=start;position<=end;position++){const unit=book.units[String(position)];if(unit?.status==='text'&&unit.text.trim())units.push({text:unit.text,ref:kind==='page'?{type:'document',page:position}:{type:'document',page:1,blockIndex:position-1}});}}
  else {
   const segments=row.contentType==='VIDEO'?await db.transcriptSegment.findMany({where:{contentId:row.id,...(scope.mode==='range'?{startMs:{gte:scope.start*1000},endMs:{lte:scope.end*1000}}:{})},orderBy:{seq:'asc'},take:1001}):[];
   const blocks=await db.textBlock.findMany({where:{contentId:row.id,...(scope.mode==='range'&&row.contentType==='VIDEO'?{AND:[{ref:{path:['timestampSec'],gte:scope.start}},{ref:{path:['timestampSec'],lte:scope.end}}]}:{})},orderBy:[{sequence:'asc'},{id:'asc'}],take:1001});
   if(segments.length>1000||blocks.length>1000)throw topicInvalid('来源超过1000个解析单元，请在书籍阅读区选择较小范围。');
   for(const segment of segments){if(segment.startMs<0||segment.endMs<segment.startMs||row.durationSec===null||segment.endMs>row.durationSec*1000)throw topicInvalid('转写时间定位无效，请先核对原解析结果。');if(segment.text.trim())units.push({text:segment.text,ref:{type:'video',timestampSec:Math.floor(segment.startMs/1000)}});}
   for(const block of blocks){const parsed=contentRefSchema.safeParse(block.ref);if(!parsed.success||(parsed.data.type==='video')!==(row.contentType==='VIDEO')||!isRefInRange(parsed.data,{durationSec:row.durationSec,pageCount:row.pageCount}))throw topicInvalid('原文定位无效，请先核对解析结果。');if(scope.mode==='range'&&parsed.data.type==='video'&&(parsed.data.timestampSec<scope.start||parsed.data.timestampSec>scope.end))continue;if(block.text.trim())units.push({text:block.text,ref:parsed.data});}
  }
  const count=units.reduce((sum,unit):number=>sum+unit.text.length,0);characters+=count;
  if(units.length>TOPIC_LIMITS.units||count>TOPIC_LIMITS.sourceCharacters||characters>TOPIC_LIMITS.characters)throw topicInvalid('所选已解析文字超过检索预算，请缩小范围（每来源1000单元/50万字、总计200万字）。');
  const version=topicDigest({source:book?.sourceDigest??null,scope,kind,total,units});
  coverage.push({...(book?.pastedSource?{pasteSource:publicPasteSource(book.pastedSource)}:{}),contentId:row.id,title:row.title,format:row.format,mode:scope.mode,start:scope.mode==='range'?scope.start:null,end:scope.mode==='range'?scope.end:null,unitKind:kind,readable:units.length,total,missing:total===null?null:total-units.length,version});
  all.push(...windows(units.map((unit):Omit<TopicEvidence,'id'|'offset'>=>({...unit,contentId:row.id,title:row.title,version}))));
 }
 const evidence=retrieve(all,question).map((item,index):TopicEvidence=>({...item,id:String(index+1)}));return{question,scopeDigest:topicDigest({revision,question,coverage,evidence}),coverage,evidence,characters:evidence.reduce((sum,item):number=>sum+item.text.length,0)};
}
