import { z } from 'zod';

export const BOOK_LIMITS = { chapters: 200, bookmarks: 100, pdfPages: 2000, paragraphs: 20000, range: 20, unitCharacters: 20000, storedCharacters: 500000, bytes: 50 * 1024 * 1024 } as const;
const position = z.number().int().min(1).max(BOOK_LIMITS.paragraphs);
export const chapterInput = z.object({ title: z.string().trim().min(1).max(160), start: position, end: position }).strict();
export type ChapterInput = z.infer<typeof chapterInput>;
export type BookChapter = ChapterInput & { id: string; origin: 'pdf-outline' | 'heading' | 'page-range' | 'manual' | 'epub-nav' | 'epub-spine' };
export type BookUnit = { text: string; status: 'text' | 'needs-ocr' | 'empty' };
export type BookState = { version: 1; pastedSource?: import('@/lib/text-imports/contracts').StoredPasteSource; readingJournal?: import('@/lib/reading-notes/contracts').ReadingJournal; format: 'PDF' | 'TXT' | 'MD' | 'EPUB'; sourceDigest: string; unitKind: 'page' | 'paragraph'; unitCount: number; chapters: BookChapter[]; cursor: number; bookmarks: { position: number; label: string }[]; units: Record<string, BookUnit>; requests: { id: string; digest: string }[] };
export type BookView = Omit<BookState, 'units' | 'requests' | 'version' | 'readingJournal' | 'pastedSource'> & { revision: number; processedCount: number; readableCount: number; needsOcrCount: number; start: number; end: number; readingUnits: { position: number; value: BookUnit | null }[] };
export type BookResult = { book: BookView | null };
const base = { expectedRevision: z.number().int().min(0).max(2147483646), requestId: z.string().uuid() };
const bound = { ...base, sourceDigest: z.string().regex(/^[a-f0-9]{64}$/) };
export const bookCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('initialize') }).strict(),
  z.object({ ...bound, action: z.literal('chapters'), chapters: chapterInput.array().min(1).max(BOOK_LIMITS.chapters) }).strict(),
  z.object({ ...bound, action: z.literal('extract'), start: position, end: position }).strict(),
  z.object({ ...bound, action: z.literal('cursor'), position }).strict(),
  z.object({ ...bound, action: z.literal('bookmark'), position, label: z.string().trim().min(1).max(80) }).strict(),
  z.object({ ...bound, action: z.literal('removeBookmark'), position }).strict(),
]);
export type BookCommand = z.infer<typeof bookCommandSchema>;

export function validChapters(chapters: ChapterInput[], count: number): boolean {
  return chapters.length > 0 && chapters.length <= BOOK_LIMITS.chapters && chapters.every((item, index): boolean => item.start <= item.end && item.end <= count && (index === 0 || chapters[index - 1].end < item.start));
}
export function validBookRange(start: number, end: number, count: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= count && end - start < BOOK_LIMITS.range;
}
export function chapterId(start: number, end: number): string { return `range-${start}-${end}`; }
export function chaptersFromStarts(starts: { title: string; position: number }[], count: number, origin: BookChapter['origin'], fallbackSize: number): BookChapter[] {
  const seen = new Set<number>();
  const ordered = starts.filter((item): boolean => item.position >= 1 && item.position <= count && !!item.title.trim()).sort((a,b): number => a.position-b.position).filter((item): boolean => { if(seen.has(item.position))return false; seen.add(item.position); return true; });
  if (ordered.length > BOOK_LIMITS.chapters) ordered.length = 0;
  fallbackSize=Math.max(fallbackSize,Math.ceil(count/BOOK_LIMITS.chapters));
  if (!ordered.length) return Array.from({length: Math.ceil(count/fallbackSize)},(_,index): BookChapter => { const start=index*fallbackSize+1,end=Math.min(count,start+fallbackSize-1);return {id:chapterId(start,end),title:`自动分段 ${start}–${end}`,start,end,origin:'page-range'}; });
  const entries = ordered[0].position > 1 ? [{title:'目录前内容',position:1},...ordered] : ordered;
  if(entries.length>BOOK_LIMITS.chapters)return chaptersFromStarts([],count,'page-range',fallbackSize);
  return entries.slice(0,BOOK_LIMITS.chapters).map((item,index):BookChapter=>{const end=entries[index+1]?.position ? entries[index+1].position-1 : count;return{id:chapterId(item.position,end),title:item.title.trim().slice(0,160),start:item.position,end,origin:item.title==='目录前内容'?'page-range':origin};});
}
export function bookView(state: BookState, revision: number, start=state.cursor, end=Math.min(state.unitCount,start+BOOK_LIMITS.range-1)): BookView {
  const {pastedSource:_pastedSource,readingJournal:_readingJournal,units,requests: _requests,version: _version,...metadata}=state;
  const values=Object.values(units);
  return {...metadata,revision,processedCount:values.length,readableCount:values.filter((unit):boolean=>unit.status==='text').length,needsOcrCount:values.filter((unit):boolean=>unit.status==='needs-ocr').length,start,end,readingUnits:Array.from({length:end-start+1},(_,index):{position:number;value:BookUnit|null}=>({position:start+index,value:units[String(start+index)]??null}))};
}
