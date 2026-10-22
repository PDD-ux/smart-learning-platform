import {z} from 'zod';
export const PASTE_LIMITS={characters:100000,requestBytes:512*1024,previewCharacters:12000};
const fields={title:z.string().trim().min(1).max(100),sourceLabel:z.string().trim().min(1).max(300),author:z.string().trim().max(100),text:z.string().min(20).max(PASTE_LIMITS.characters)};
export const pasteCommandSchema=z.discriminatedUnion('action',[
 z.object({...fields,action:z.literal('preview')}).strict(),
 z.object({...fields,action:z.literal('confirm'),requestId:z.string().uuid(),previewDigest:z.string().regex(/^[a-f0-9]{64}$/u),confirmed:z.literal(true)}).strict(),
]);
export type PasteCommand=z.infer<typeof pasteCommandSchema>;
export type PasteInput=Pick<PasteCommand,'title'|'sourceLabel'|'author'|'text'>;
export type PasteSource={version:1;kind:'PASTE';label:string;author:string|null;importedAt:string;bodyDigest:string};
export type StoredPasteSource=PasteSource&{requestId:string;inputDigest:string};
export type PastePreview={title:string;sourceLabel:string;author:string|null;bodyDigest:string;previewDigest:string;characters:number;paragraphs:number;chapters:number;excerpt:string;previewCharacters:number};
export type PasteResult={preview:PastePreview}|{contentId:string;source:PasteSource};
export function publicPasteSource(source:StoredPasteSource):PasteSource{return{version:1,kind:'PASTE',label:source.label,author:source.author,importedAt:source.importedAt,bodyDigest:source.bodyDigest};}
