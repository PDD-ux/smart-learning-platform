import { beforeEach,describe,expect,it,vi } from 'vitest';
const pdf=vi.hoisted(()=>({getPage:vi.fn(),getOutline:vi.fn(),getPageIndex:vi.fn(),getDestination:vi.fn(),destroy:vi.fn()}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({getDocument:():object=>({promise:Promise.resolve({numPages:222,...pdf}),destroy:pdf.destroy})}));
import { initializeBook,extractBookUnits,plainBookBlocks } from '@/lib/books/source';
beforeEach(():void=>{vi.clearAllMocks();pdf.getOutline.mockResolvedValue([{title:'目录',dest:[0],items:[]},{title:'正文',dest:'body',items:[]}]);pdf.getDestination.mockResolvedValue([{num:10}]);pdf.getPageIndex.mockResolvedValue(10);pdf.getPage.mockImplementation(async(number:number):Promise<object>=>({getTextContent:async():Promise<object>=>({items:number===2?[]:[{str:`实际第${number}页文字`,hasEOL:true}]}),cleanup:vi.fn()}));});
describe('book source parsing',():void=>{
  it('preserves existing paragraph numbering and never renders markup as executable content',async():Promise<void>=>{
    const bytes=Buffer.from('# 第一章\n\n第一行\n第二行\n\n<img src=x onerror=alert(1)>\n\n## 第二章\n\n末段');
    expect(plainBookBlocks(bytes).map((block):string=>block.text)).toEqual(['# 第一章','第一行 第二行','<img src=x onerror=alert(1)>','## 第二章','末段']);
    const state=await initializeBook(bytes,'MD');expect(state.unitCount).toBe(5);expect(state.chapters.map((chapter):number=>chapter.start)).toEqual([1,4]);expect(state.chapters[0].origin).toBe('heading');
    const units=await extractBookUnits(bytes,state,2,3);expect(Object.keys(units)).toEqual(['2','3']);expect(units['2'].text).toBe('第一行 第二行');expect(units['3'].text).toContain('<img');
  });
  it('does not infer Markdown chapter headings from fenced examples',async():Promise<void>=>{
    const state=await initializeBook(Buffer.from('```md\n# 代码标题\n\n# 仍是代码\n```\n\n# 正文标题\n\n原文'),'MD');expect(state.chapters.some((chapter):boolean=>chapter.title==='仍是代码')).toBe(false);expect(state.chapters.some((chapter):boolean=>chapter.title==='正文标题')).toBe(true);
  });
  it('recognizes Chinese TXT headings and labels titleless text as automatic ranges',async():Promise<void>=>{
    const state=await initializeBook(Buffer.from('第一章 基础\n\n真实正文\n\n第二章 应用\n\n应用正文'),'TXT');expect(state.chapters.map((chapter):string=>chapter.title)).toEqual(['第一章 基础','第二章 应用']);
    expect((await initializeBook(Buffer.from('普通原文\n\n下一段'),'TXT')).chapters[0].origin).toBe('page-range');
  });
  it('does not turn body sentences beginning with a chapter number into hundreds of TOC entries',async():Promise<void>=>{
    const bytes=Buffer.from(Array.from({length:12},(_,chapter):string=>`# 第${chapter+1}章 自主学习\n\n`+Array.from({length:20},(_,paragraph):string=>`第${chapter+1}章第${paragraph+1}段：真实正文`).join('\n\n')).join('\n\n'));
    const state=await initializeBook(bytes,'MD');expect(state.unitCount).toBe(252);expect(state.chapters.length).toBe(12);expect(state.chapters.every((chapter):boolean=>chapter.origin==='heading')).toBe(true);
  });
  it('rejects invalid UTF8 or an empty document instead of manufacturing a chapter',async():Promise<void>=>{
    await expect(initializeBook(Buffer.from([255,254,0]),'TXT')).rejects.toThrow();await expect(initializeBook(Buffer.from('  '),'TXT')).rejects.toThrow();
  });
  it('reads real PDF destinations without extracting the full 222-page book',async():Promise<void>=>{
    const state=await initializeBook(Buffer.from('pdf-mock'),'PDF');expect(state.unitCount).toBe(222);expect(state.chapters[1].start).toBe(11);expect(pdf.getPage).not.toHaveBeenCalled();
    const units=await extractBookUnits(Buffer.from('pdf-mock'),state,1,3);expect(pdf.getPage.mock.calls.map((call):unknown=>call[0])).toEqual([1,2,3]);expect(units['2']).toEqual({text:'',status:'needs-ocr'});expect(Object.keys(state.units)).toHaveLength(0);expect(pdf.destroy).toHaveBeenCalledTimes(2);
  });
  it('falls back from damaged outline metadata without calling it an original TOC',async():Promise<void>=>{
    pdf.getOutline.mockRejectedValue(new Error('broken outline'));const state=await initializeBook(Buffer.from('pdf-mock'),'PDF');expect(state.chapters.every((chapter):boolean=>chapter.origin==='page-range')).toBe(true);
  });
  it('rejects oversized paragraphs without partially committing an index',async():Promise<void>=>{
    const bytes=Buffer.from('字'.repeat(20001));const state=await initializeBook(bytes,'TXT');await expect(extractBookUnits(bytes,state,1,1)).rejects.toThrow('BOOK_UNIT_LIMIT');expect(state.units).toEqual({});
  });
});
