import { describe,it,expect } from 'vitest';
import { BOOK_LIMITS,bookCommandSchema,bookView,chaptersFromStarts,validChapters,validBookRange,type BookState } from '@/lib/books/contracts';
import { studyCitationUrl,resolveStudyLocation } from '@/lib/domain/study-location';
const state:BookState={version:1,format:'TXT',sourceDigest:'a'.repeat(64),unitKind:'paragraph',unitCount:25,chapters:[],cursor:3,bookmarks:[],units:{'1':{text:'真实原文',status:'text'},'2':{text:'',status:'needs-ocr'}},requests:[{id:'private-key',digest:'private-digest'}]};
describe('book reading bounds and stable citations',():void=>{
  it('rejects overlapping, reversed, unsorted and out-of-source chapters',():void=>{
    expect(validChapters([{title:'一',start:1,end:4},{title:'二',start:5,end:25}],25)).toBe(true);
    for(const chapters of [[{title:'一',start:5,end:3}],[{title:'一',start:1,end:26}],[{title:'一',start:1,end:5},{title:'二',start:5,end:8}]])expect(validChapters(chapters,25)).toBe(false);
  });
  it('limits each actual text extraction to twenty physical units',():void=>{
    expect(validBookRange(1,20,222)).toBe(true);for(const [start,end] of [[0,1],[1,21],[10,9],[1.2,5],[221,223]])expect(validBookRange(start,end,222)).toBe(false);
  });
  it('distinguishes real outline headings from automatic ranges and supplies preface',():void=>{
    const chapters=chaptersFromStarts([{title:'第一章',position:5},{title:'第二章',position:15}],25,'pdf-outline',10);
    expect(chapters.map((chapter):number[]=>[chapter.start,chapter.end])).toEqual([[1,4],[5,14],[15,25]]);expect(chapters[0].origin).toBe('page-range');expect(chapters[1].origin).toBe('pdf-outline');
    const fallback=chaptersFromStarts([],20000,'heading',50);expect(fallback.length).toBeLessThanOrEqual(BOOK_LIMITS.chapters);expect(fallback.at(-1)?.end).toBe(20000);expect(fallback.every((chapter):boolean=>chapter.origin==='page-range')).toBe(true);
  });
  it('handles duplicate outline destinations without creating inverted sections',():void=>{
    const chapters=chaptersFromStarts([{title:'第二章',position:10},{title:'第一章',position:1},{title:'同页小节',position:1},{title:'非法页',position:999}],20,'pdf-outline',10);
    expect(validChapters(chapters,20)).toBe(true);expect(chapters.map((chapter):number=>chapter.start)).toEqual([1,10]);
  });
  it('does not disclose request digests or pretend empty or unprocessed units are readable',():void=>{
    const view=bookView(state,4,1,3);expect(view.processedCount).toBe(2);expect(view.readableCount).toBe(1);expect(view.needsOcrCount).toBe(1);expect(view.readingUnits[2].value).toBeNull();expect(view).not.toHaveProperty('requests');expect(view).not.toHaveProperty('units');
  });
  it('rejects unrecognized write fields and missing source or revision',():void=>{
    const command={action:'cursor',position:2,expectedRevision:1,sourceDigest:'a'.repeat(64),requestId:'ed2f7b67-46a8-42b0-9575-a3670b303682'};
    expect(bookCommandSchema.safeParse(command).success).toBe(true);expect(bookCommandSchema.safeParse({...command,ownerId:'other'}).success).toBe(false);expect(bookCommandSchema.safeParse({...command,expectedRevision:-1}).success).toBe(false);expect(bookCommandSchema.safeParse({...command,sourceDigest:''}).success).toBe(false);
  });
  it('keeps old page links and adds an original paragraph anchor without changing ContentRef',():void=>{
    expect(studyCitationUrl('book',{type:'document',page:1,blockIndex:12})).toBe('/study/book?page=1&block=12');
    expect(resolveStudyLocation({page:'1',block:'12'},{contentType:'document',pageCount:1,durationSec:null})).toEqual({type:'document',page:1,blockIndex:12});
    expect(resolveStudyLocation({page:'1',block:'-1'},{contentType:'document',pageCount:1,durationSec:null})).toEqual({type:'document',page:1});
  });
});
