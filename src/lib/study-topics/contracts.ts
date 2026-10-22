import {z} from 'zod';
import type {ContentRef} from '@/lib/domain/content-ref';
export const TOPIC_LIMITS={sources:8,topics:20,answers:30,units:1000,sourceCharacters:500000,characters:2000000,windows:8,windowCharacters:400,bytes:1048576};
const id=z.string().min(1).max(128),integer=z.number().int().min(0).max(1000000);
export const scopeSchema=z.discriminatedUnion('mode',[
 z.object({contentId:id,mode:z.literal('parsed')}).strict(),
 z.object({contentId:id,mode:z.literal('range'),start:integer,end:integer}).strict(),
]);
export type TopicScope=z.infer<typeof scopeSchema>;
const sources=scopeSchema.array().min(1).max(8).refine((value):boolean=>new Set(value.map((s):string=>s.contentId)).size===value.length);
const title=z.string().trim().min(1).max(80),requestId=z.string().uuid(),question=z.string().trim().min(2).max(500),expectedRevision=z.number().int().positive();
export const createTopicSchema=z.object({requestId,title,sources}).strict();
export const topicCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('update'),requestId,expectedRevision,title,sources,archived:z.boolean()}).strict(),
 z.object({action:z.literal('preview'),question}).strict(),
 z.object({action:z.literal('ask'),requestId,question,scopeDigest:z.string().regex(/^[a-f0-9]{64}$/u),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal('cancel'),requestId,expectedRevision,answerId:z.string().uuid()}).strict(),
 z.object({action:z.literal('export'),format:z.enum(['md','txt'])}).strict(),
]);
export type CreateTopic=z.infer<typeof createTopicSchema>;
export type TopicCommand=z.infer<typeof topicCommandSchema>;
export type SourceCoverage={pasteSource?:import('@/lib/text-imports/contracts').PasteSource;contentId:string;title:string;format:string;mode:'parsed'|'range';start:number|null;end:number|null;unitKind:'page'|'paragraph'|'second';readable:number;total:number|null;version:string;missing:number|null};
export type TopicEvidence={id:string;contentId:string;title:string;version:string;ref:ContentRef;offset:number;text:string};
export type TopicCitation=Omit<TopicEvidence,'text'>&{quote:string};
export type TopicPreview={question:string;scopeDigest:string;coverage:SourceCoverage[];evidence:TopicEvidence[];characters:number};
export type TopicAnswer={id:string;inputDigest:string;state:'RUNNING'|'READY'|'INSUFFICIENT'|'FAILED'|'CANCELLED';question:string;scopeDigest:string;coverage:SourceCoverage[];citations:TopicCitation[];reason:string|null;createdAt:string;leaseUntil:string|null};
export type TopicData={version:1;sources:TopicScope[];answers:TopicAnswer[];requests:{id:string;digest:string}[];archived:boolean};
export type TopicView={id:string;title:string;revision:number;sources:TopicScope[];answers:TopicAnswer[];archived:boolean;availability:{contentId:string;available:boolean}[]};
export type TopicList={items:{id:string;title:string;revision:number;archived:boolean;sourceCount:number;answerCount:number}[]};
export type TopicCandidates={items:{id:string;title:string;format:string;type:'VIDEO'|'DOCUMENT';book:boolean}[];page:number;total:number;pageSize:50};
export function topicLink(c:Pick<TopicCitation,'contentId'|'ref'>):string {const root='/study/'+encodeURIComponent(c.contentId);return root+(c.ref.type==='video'?'?t='+c.ref.timestampSec:'?page='+c.ref.page+(c.ref.blockIndex===undefined?'':'&block='+c.ref.blockIndex));}
export function citationLabel(c:Pick<TopicCitation,'ref'>):string{return c.ref.type==='video'?`${Math.floor(c.ref.timestampSec/60)}:${String(c.ref.timestampSec%60).padStart(2,'0')}`:c.ref.blockIndex===undefined?`第${c.ref.page}页`:`第${c.ref.blockIndex+1}段`;}
