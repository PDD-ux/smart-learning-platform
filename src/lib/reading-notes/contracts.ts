import {z} from 'zod';
export const READING_LIMITS={entries:100,inputCharacters:4500,quote:2000,annotation:4000,bytes:1024*1024} as const;
export type ReadingPoint={position:number;start:number;end:number;quote:string};
export type ReadingEntry={id:string;inputDigest:string;kind:'AI'|'EXCERPT';state:'RUNNING'|'READY'|'FAILED'|'CANCELLED';version:number;sourceDigest:string;contextDigest:string;start:number;end:number;unitKind:'page'|'paragraph';totalUnits:number;title:string;points:ReadingPoint[];annotation:string;tags:string[];reason:string|null;createdAt:string;updatedAt:string;leaseUntil:string|null;removed:boolean};
export type ReadingJournal={revision:number;entries:ReadingEntry[];requests:{id:string;digest:string}[]};
export type ReadingContext={pasteSource?:import('@/lib/text-imports/contracts').PasteSource;sourceDigest:string;digest:string;start:number;end:number;unitKind:'page'|'paragraph';totalUnits:number;title:string;units:{position:number;text:string|null}[]};
export type ReadingResult={context:ReadingContext;journalRevision:number;items:ReadingEntry[];page:number;pageSize:20;total:number};
const range={sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),contextDigest:z.string().regex(/^[a-f0-9]{64}$/),start:z.number().int().min(1).max(20000),end:z.number().int().min(1).max(20000)};
const base={requestId:z.string().uuid()};
const fields={annotation:z.string().max(4000),tags:z.string().trim().min(1).max(24).array().max(5)};
const item={...base,entryId:z.string().uuid(),expectedVersion:z.number().int().min(1)};
export const readingCommandSchema=z.discriminatedUnion('action',[
 z.object({...base,...range,action:z.literal('generate'),confirmed:z.literal(true)}).strict(),
 z.object({...base,...range,...fields,action:z.literal('excerpt'),position:z.number().int().min(1).max(20000),offsetStart:z.number().int().min(0),offsetEnd:z.number().int().min(1)}).strict(),
 z.object({...item,...fields,action:z.literal('update')}).strict(),
 z.object({...item,action:z.literal('remove')}).strict(),
 z.object({...item,action:z.literal('restore')}).strict(),
 z.object({...item,action:z.literal('cancel')}).strict(),
]);
export type ReadingCommand=z.infer<typeof readingCommandSchema>;
export function emptyJournal():ReadingJournal{return{revision:0,entries:[],requests:[]};}
export function pointLink(contentId:string,kind:'page'|'paragraph',position:number):string{return '/study/'+encodeURIComponent(contentId)+(kind==='page'?'?page='+position:'?page=1&block='+(position-1));}
export function readingExport(contentId:string,items:ReadingEntry[],page:number,format:'md'|'txt'):string{
 const lines=['阅读笔记 · 当前第'+page+'页记录','资料ID：'+contentId,'仅导出本页已读取记录；不是整书/全部笔记。',''];
 for(const item of items){lines.push((format==='md'?'## ':'')+item.title,`${item.kind==='AI'?'AI精选原文要点（非改写摘要，可能有遗漏）':'本人原文摘录'} · ${item.state}${item.removed?' · 已移除':''}`,`输入范围：${item.start}–${item.end}${item.unitKind==='page'?'页':'段'} / 全资料${item.totalUnits}单元`,`固定源SHA256：${item.sourceDigest}`);if(item.state==='READY')for(const point of item.points)lines.push((format==='md'?'> ':'')+point.quote,`来源：第${point.position}${item.unitKind==='page'?'页':'段'}，字符${point.start}–${point.end}；${pointLink(contentId,item.unitKind,point.position)}`);else lines.push(item.reason??'本条尚未形成笔记');lines.push('本人批注：'+item.annotation,'标签：'+item.tags.join('、'),'');}return lines.join('\n');
}
