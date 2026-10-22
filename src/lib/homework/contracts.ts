import { z } from 'zod';
export const FILE_LIMIT = 4 * 1024 * 1024;
export const questionSchema = z.object({number:z.string().trim().max(20),type:z.enum(['choice','truefalse','short']),prompt:z.string().max(4000),answer:z.string().max(2000),referenceAnswer:z.string().max(2000),basis:z.string().max(4000),reviewed:z.boolean()}).strict();
export type HomeworkQuestion = z.infer<typeof questionSchema>;
export const questionsSchema = z.array(questionSchema).max(20).refine((items):boolean=>new Set(items.map((q):string=>q.number.trim())).size===items.length,'题号不能重复');
const mime = z.enum(['text/plain','text/markdown','application/pdf','image/png','image/jpeg']);
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u);
export const createHomeworkSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(100),source:z.discriminatedUnion('kind',[
 z.object({kind:z.literal('text'),text:z.string().trim().min(1).max(50000)}).strict(),
 z.object({kind:z.literal('file'),fileName:z.string().min(1).max(200),mimeType:mime,base64:z.string().min(4).max(Math.ceil(FILE_LIMIT/3)*4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)}).strict(),
 z.object({kind:z.literal('submission'),versionId:identifier,attachmentId:identifier.optional()}).strict(),
])}).strict();
export type CreateHomework = z.infer<typeof createHomeworkSchema>;
const command={requestId:z.string().uuid(),expectedRevision:z.number().int().positive()};
export const homeworkCommandSchema=z.discriminatedUnion('action',[
 z.object({...command,action:z.literal('save'),questions:questionsSchema}).strict(),
 z.object({...command,action:z.literal('confirm'),confirmed:z.literal(true)}).strict(),
 z.object({...command,action:z.literal('archive')}).strict(),
]);
export type HomeworkCommand=z.infer<typeof homeworkCommandSchema>;
export type HomeworkSource={kind:'text'|'file'|'submission';label:string;fileName?:string;mimeType?:string;sizeBytes?:number;sha256?:string;versionId?:string;attachmentId?:string;method?:'manual'|'text-layer'|'ocr'|'submission-body'};
export type HomeworkView={id:string;title:string;revision:number;state:string;source:HomeworkSource;rawText:string;issues:string[];questions:HomeworkQuestion[];createdAt:string};
export type HomeworkList={items:Array<Pick<HomeworkView,'id'|'title'|'state'|'createdAt'>>;page:number;hasMore:boolean};
export function completeQuestions(items:HomeworkQuestion[]):boolean{return items.length>0&&items.every((q):boolean=>!!q.number.trim()&&!!q.prompt.trim()&&!!q.answer.trim()&&(!!q.referenceAnswer.trim()||!!q.basis.trim())&&q.reviewed);}
