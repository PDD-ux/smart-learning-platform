import path from 'node:path';
import { parseEpub } from './epub';
import { createHash } from 'node:crypto';
import { getStorage } from '@/lib/storage';
import { BOOK_LIMITS, chaptersFromStarts, type BookChapter, type BookState, type BookUnit } from './contracts';

export function plainBookBlocks(bytes: Buffer): { raw: string; text: string }[] {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u,'');
  return value.split(/\r?\n\s*\r?\n/u).map((raw):{raw:string;text:string}=>({raw:raw.trim(),text:raw.replace(/\s*\r?\n\s*/gu,' ').trim()})).filter((block):boolean=>!!block.text);
}
export async function bookBytes(key: string, declaredSize: bigint): Promise<Buffer> {
  if (declaredSize > BigInt(BOOK_LIMITS.bytes)) throw new Error('BOOK_SIZE');
  const object = await getStorage().getObject(key);
  const chunks: Buffer[]=[];let length=0;
  const timer=setTimeout(():void=>{object.stream.destroy(new Error('BOOK_TIMEOUT'));},30000);
  try {
    for await (const raw of object.stream as AsyncIterable<Buffer>) {
      const chunk=Buffer.from(raw);length+=chunk.length;
      if(length>BOOK_LIMITS.bytes)throw new Error('BOOK_SIZE');chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {clearTimeout(timer);object.stream.destroy();}
}
export function bookDigest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function pdfOperation<T>(bytes: Buffer, operation: (pdf: import('pdfjs-dist/types/src/display/api').PDFDocumentProxy) => Promise<T>): Promise<T> {
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot=path.resolve('node_modules/pdfjs-dist');
  const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,cMapUrl:path.join(packageRoot,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(packageRoot,'standard_fonts')+path.sep});
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([loading.promise.then(async (pdf):Promise<T>=>{if(pdf.numPages>BOOK_LIMITS.pdfPages)throw new Error('BOOK_PAGE_LIMIT');return operation(pdf);}),new Promise<T>((_resolve,reject):void=>{timeout=setTimeout(():void=>reject(new Error('BOOK_TIMEOUT')),30000);})]);
  } finally {if(timeout)clearTimeout(timeout);await loading.destroy();}
}

export async function initializeBook(bytes: Buffer, format: BookState['format']): Promise<BookState> {
  let unitCount=0,chapters:BookChapter[]=[];
  if(format==='EPUB') {
    const parsed=parseEpub(bytes);unitCount=parsed.paragraphs.length;chapters=parsed.chapters;
  } else if(format==='PDF') {
    const metadata=await pdfOperation(bytes,async (pdf):Promise<{count:number;chapters:BookChapter[]}>=>{
      const starts:{title:string;position:number}[]=[];
      const outline=await pdf.getOutline().catch(():null=>null);
      const pending=[...(outline??[])];let visited=0;
      while(pending.length && ++visited<=1000) {
        const item=pending.shift()!;pending.unshift(...item.items);
        try {
          const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;
          if(!Array.isArray(dest)||!dest.length)continue;
          const first=dest[0];const page=typeof first==='number'?first:await pdf.getPageIndex(first);
          if(Number.isInteger(page))starts.push({title:item.title,position:page+1});
        } catch { /* Invalid PDF destination is not a trustworthy chapter. */ }
      }
      return {count:pdf.numPages,chapters:chaptersFromStarts(visited>1000?[]:starts,pdf.numPages,'pdf-outline',10)};
    });unitCount=metadata.count;chapters=metadata.chapters;
  } else {
    const blocks=plainBookBlocks(bytes);unitCount=blocks.length;
    if(!unitCount||unitCount>BOOK_LIMITS.paragraphs)throw new Error('BOOK_PARAGRAPH_LIMIT');
    const starts:{title:string;position:number}[]=[];let fenced=false;
    blocks.forEach((block,index):void=>{
      const lines=block.raw.split(/\r?\n/u);const first=lines[0].trim();
      if(!fenced) {
        const heading=format==='MD'?/^#{1,6}\s+(.+?)(?:\s+#+)?$/u.exec(first):null;
        const chinese=/^(第[零〇一二三四五六七八九十百千万两\d]+[章节篇部卷](?:[\s　：:、.．].{0,120})?)$/u.exec(first);
        const title=heading?.[1]??chinese?.[1];if(title)starts.push({title,position:index+1});
      }
      if(format==='MD')for(const line of lines)if(/^\s*(```|~~~)/u.test(line))fenced=!fenced;
    });
    chapters=chaptersFromStarts(starts,unitCount,'heading',Math.max(50,Math.ceil(unitCount/BOOK_LIMITS.chapters)));
  }
  return {version:1,format,sourceDigest:bookDigest(bytes),unitKind:format==='PDF'?'page':'paragraph',unitCount,chapters,cursor:1,bookmarks:[],units:{},requests:[]};
}

export async function extractBookUnits(bytes: Buffer, state: BookState, start: number, end: number): Promise<Record<string,BookUnit>> {
  const units:Record<string,BookUnit>={};
  const put=(position:number,text:string):void=>{if(text.length>BOOK_LIMITS.unitCharacters)throw new Error('BOOK_UNIT_LIMIT');units[String(position)]={text,status:text.trim()?'text':state.format==='PDF'?'needs-ocr':'empty'};};
  if(state.format==='PDF')await pdfOperation(bytes,async (pdf):Promise<void>=>{
    if(pdf.numPages!==state.unitCount)throw new Error('BOOK_SOURCE_CHANGED');
    for(let number=start;number<=end;number++) {
      const page=await pdf.getPage(number);
      try {const content=await page.getTextContent();let text='';for(const item of content.items)if('str'in item)text+=item.str+(item.hasEOL?'\n':' ');put(number,text.trim());}finally{page.cleanup();}
    }
  });
  else {const blocks=state.format==='EPUB'?parseEpub(bytes).paragraphs.map((text):{text:string}=>({text})):plainBookBlocks(bytes);if(blocks.length!==state.unitCount)throw new Error('BOOK_SOURCE_CHANGED');for(let number=start;number<=end;number++)put(number,blocks[number-1].text);}
  return units;
}
