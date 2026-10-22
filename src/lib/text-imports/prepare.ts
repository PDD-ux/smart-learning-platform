import {createHash} from 'node:crypto';
import {initializeBook,plainBookBlocks} from '@/lib/books/source';
import {BOOK_LIMITS,type BookState} from '@/lib/books/contracts';
import {ApiError} from '@/lib/auth/ownership';
import {ErrorCode} from '@/lib/api/errors';
import {PASTE_LIMITS,type PasteInput,type PastePreview} from './contracts';
export const pasteInvalid=(message:string):ApiError=>new ApiError(ErrorCode.VALIDATION_FAILED,message);
export const pasteConflict=():ApiError=>new ApiError(ErrorCode.NOTE_CONFLICT,'正文、来源或确认状态已变化，请保留输入并重新预览。');
export function pasteHash(value:string|Buffer):string{return createHash('sha256').update(value).digest('hex');}
export async function preparePaste(input:PasteInput):Promise<{input:PasteInput;bytes:Buffer;book:BookState;preview:PastePreview}>{
 const normalized={title:input.title.trim(),sourceLabel:input.sourceLabel.trim(),author:input.author.trim(),text:input.text.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n').trim()};
 if(normalized.text.length<20||normalized.text.length>PASTE_LIMITS.characters||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized.text)||!/[\p{L}\p{N}]/u.test(normalized.text))throw pasteInvalid('正文须为20–100000字的有效纯文本，不能包含控制符。');
 const bytes=Buffer.from(normalized.text,'utf8'),blocks=plainBookBlocks(bytes);if(blocks.length>BOOK_LIMITS.paragraphs||blocks.some((block):boolean=>block.text.length>BOOK_LIMITS.unitCharacters))throw pasteInvalid('每段最多20000字、总计最多20000段，请用空行分段后再预览。');let book:BookState;
 try{book=await initializeBook(bytes,'TXT');}catch{throw pasteInvalid('正文无法按段读取：每段最多20000字，请用空行分段后再预览。');}
 const bodyDigest=pasteHash(bytes),previewDigest=pasteHash(JSON.stringify(normalized)),excerpt=normalized.text.slice(0,PASTE_LIMITS.previewCharacters);
 return{input:normalized,bytes,book,preview:{title:normalized.title,sourceLabel:normalized.sourceLabel,author:normalized.author||null,bodyDigest,previewDigest,characters:normalized.text.length,paragraphs:blocks.length,chapters:book.chapters.length,excerpt,previewCharacters:excerpt.length}};
}
