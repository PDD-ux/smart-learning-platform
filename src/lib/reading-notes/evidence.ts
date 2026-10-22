import {publicPasteSource} from '@/lib/text-imports/contracts';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {BookState} from '@/lib/books/contracts';
import {validBookRange} from '@/lib/books/contracts';
import {checkContent} from '@/lib/ai/content-guard';
import {READING_LIMITS,type ReadingContext,type ReadingPoint} from './contracts';
export const readingDigest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readingContext(state:BookState,start:number,end:number):ReadingContext{
 if(!validBookRange(start,end,state.unitCount))throw Error('RANGE');
 const units=Array.from({length:end-start+1},(_,index):ReadingContext['units'][number]=>{const position=start+index,unit=state.units[String(position)];return{position,text:unit?.status==='text'&&unit.text.trim()?unit.text:null};});
 const chapter=state.chapters.find((item):boolean=>item.start<=start&&item.end>=end);
 return{...(state.pastedSource?{pasteSource:publicPasteSource(state.pastedSource)}:{}),sourceDigest:state.sourceDigest,digest:readingDigest({source:state.sourceDigest,start,end,units}),start,end,unitKind:state.unitKind,totalUnits:state.unitCount,title:(chapter?.title??'选定范围')+' · '+start+'–'+end+(state.unitKind==='page'?'页':'段')+(chapter&&(chapter.start!==start||chapter.end!==end)?'（章内部分范围）':''),units};
}
export function readyContext(context:ReadingContext,ai:boolean):void{
 if(context.units.some((unit):boolean=>!unit.text))throw Error('UNREAD');
 if(ai&&context.units.reduce((sum,unit):number=>sum+(unit.text?.length??0),0)>READING_LIMITS.inputCharacters)throw Error('BUDGET');
 if(ai&&context.units.some((unit):boolean=>!checkContent(unit.text??'').safe))throw Error('BLOCKED');
}
export function excerptPoint(context:ReadingContext,position:number,start:number,end:number):ReadingPoint{
 const text=context.units.find((unit):boolean=>unit.position===position)?.text;
 if(!text||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||end-start>READING_LIMITS.quote)throw Error('QUOTE');
 const quote=text.slice(start,end);if(!/[\p{L}\p{N}]/u.test(quote))throw Error('QUOTE');return{position,start,end,quote};
}
export function verifiedAiPoints(raw:string,context:ReadingContext):ReadingPoint[]{
 const schema=z.object({points:z.object({position:z.number().int(),quote:z.string().min(1).max(180)}).strict().array().min(1).max(5)}).strict();
 const parsed=schema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'')));const seen=new Set<string>();
 return parsed.points.map((point):ReadingPoint=>{const text=context.units.find((unit):boolean=>unit.position===point.position)?.text,start=text?.indexOf(point.quote)??-1,key=point.position+':'+start+':'+point.quote.length;if(start<0||seen.has(key)||!point.quote.trim()||!checkContent(point.quote).safe)throw Error('QUOTE');seen.add(key);return excerptPoint(context,point.position,start,start+point.quote.length);});
}
