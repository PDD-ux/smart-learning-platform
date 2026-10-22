'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { ReadingNotes } from './ReadingNotes';
import { books } from '@/services/books';
import { BOOK_LIMITS, chapterInput, validBookRange, type BookCommand, type BookView } from '@/lib/books/contracts';

type Action = BookCommand extends infer Command ? Command extends BookCommand ? Omit<Command,'expectedRevision'|'requestId'|'sourceDigest'> : never : never;
type Props={contentId:string;page:number;initialBlock?:number;sourceUrl?:string;onPage:(page:number)=>void;onBlock:(index:number)=>void;children:ReactNode};
const control='min-h-11 rounded-xl border border-glass-line px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';
const originLabel={ 'pdf-outline':'PDF内置目录',heading:'按标题识别，待校对','page-range':'自动分段，非原书目录',manual:'本人校订','epub-nav':'EPUB内置导航','epub-spine':'EPUB阅读顺序，非原书目录'};

export function BookReader({contentId,page,initialBlock,sourceUrl,onPage,onBlock,children}:Props):ReactElement {
  const [book,setBook]=useState<BookView|null>(null),[loading,setLoading]=useState(true),[bookBusy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [notesMounted,setNotesMounted]=useState(false),[notesBusy,setNotesBusy]=useState(false);
  const busy=bookBusy||notesBusy;
  const [start,setStart]=useState('1'),[end,setEnd]=useState('1'),[draft,setDraft]=useState(''),[savedDraft,setSavedDraft]=useState('');
  const pending=useRef(false),mounted=useRef(true),version=useRef(0),attempt=useRef<{key:string;body:BookCommand}|null>(null);
  const draftInitialized=useRef(false);
  const callback=useRef(onBlock);callback.current=onBlock;
  const apply=(value:BookView,replaceDraft=false):void=>{
    setBook(value);
    if(replaceDraft){draftInitialized.current=true;const text=value.chapters.map((item):string=>`${item.title} | ${item.start} | ${item.end}`).join('\n');setDraft(text);setSavedDraft(text);setStart(String(value.start));setEnd(String(value.end));}
    if(value.unitKind==='paragraph')callback.current(value.start-1);
  };
  useEffect(()=>{
    mounted.current=true;const revision=++version.current;setLoading(true);setError('');
    void Promise.resolve().then(()=>books.read(contentId)).then(async(result):Promise<void>=>{
      let value=result.book;
      if(value && initialBlock!==undefined){if(initialBlock<0||initialBlock>=value.unitCount)throw new Error('引用段落不在这份书籍范围内');value=(await books.read(contentId,initialBlock+1,Math.min(value.unitCount,initialBlock+20))).book;}
      if(!mounted.current||version.current!==revision)return;
      if(value)apply(value,!draftInitialized.current);else setBook(null);
    }).catch((reason:unknown):void=>{if(mounted.current&&version.current===revision)setError(reason instanceof Error?reason.message:'书籍目录读取失败，请重试。');}).finally(():void=>{if(mounted.current&&version.current===revision)setLoading(false);});
    return():void=>{mounted.current=false;};
    // Callback changes do not reload a book or reset the learner's draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[contentId,initialBlock]);

  const execute=async(action:Action):Promise<BookView|null>=>{
    if(pending.current)return null;pending.current=true;setBusy(true);setError('');setNotice('');
    const key=JSON.stringify({action,revision:book?.revision??0});
    if(attempt.current?.key!==key)attempt.current={key,body:{...action,expectedRevision:book?.revision??0,requestId:crypto.randomUUID(),...(action.action==='initialize'?{}:{sourceDigest:book?.sourceDigest??''})} as BookCommand};
    const captured=version.current;
    try{
      const result=await books.write(contentId,attempt.current.body);
      if(!mounted.current||captured!==version.current)return null;
      if(!result.book)throw new Error('书籍响应缺少状态，请重新读取核对。');
      apply(result.book,action.action==='initialize');attempt.current=null;
      if(action.action==='chapters'){setSavedDraft(draft);setNotice('目录已保存；原笔记和来源位置保持不变。');}
      else if(action.action==='extract')setNotice('选段正文已保存；这不是AI整理或全书理解完成。');
      else setNotice('书籍位置或书签已保存。');
      return result.book;
    }catch(reason){if(mounted.current&&captured===version.current)setError(reason instanceof Error?reason.message:'操作失败，输入已保留，请先核对再手动重试。');return null;}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  };
  const reload=async():Promise<void>=>{
    if(pending.current || (draft!==savedDraft&&!window.confirm('重新读取会放弃尚未保存的目录校订，是否继续？')))return;
    pending.current=true;setBusy(true);setError('');const captured=version.current;
    try{const result=await books.read(contentId);if(mounted.current&&captured===version.current){if(result.book)apply(result.book,true);else setBook(null);attempt.current=null;}}catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'读取失败，校订草稿已保留。');}finally{pending.current=false;if(mounted.current)setBusy(false);}
  };
  const navigate=async(position:number):Promise<void>=>{const result=await execute({action:'cursor',position});if(result){setStart(String(position));setEnd(String(Math.min(result.unitCount,position+19)));if(result.unitKind==='page')onPage(position);}};
  const saveChapters=():void=>{
    const chapters=draft.split(/\r?\n/u).filter((line):boolean=>!!line.trim()).map((line):unknown=>{const parts=line.split('|');if(parts.length<3)return null;const end=parts.pop(),start=parts.pop();return{title:parts.join('|').trim(),start:Number(start),end:Number(end)};});
    const parsed=chapterInput.array().min(1).max(BOOK_LIMITS.chapters).safeParse(chapters);
    if(!parsed.success){setError('请每行填写：标题 | 起始位置 | 结束位置，最多200章。');return;}
    void execute({action:'chapters',chapters:parsed.data});
  };
  const position=book?.unitKind==='page'?page:book?.start??1;
  const label=book?.unitKind==='page'?'页':'段';
  const bookmarked=book?.bookmarks.some((item):boolean=>item.position===position)??false;
  return <section aria-label="书籍目录与分章阅读" className="min-w-0">
    <div className="border-b border-glass-line bg-surface p-4 sm:p-5">
      <h2 className="font-semibold">书籍目录与分章阅读</h2>
      <p className="mt-2 text-xs leading-6 text-textSub">按真实页码或原段落阅读。选段只提取正文；原AI笔记另存，不代表整本书已理解。</p>
      {loading?<p role="status" className="mt-3 text-sm">正在读取书籍状态…</p>:!book?<button type="button" disabled={busy} onClick={():void=>{void execute({action:'initialize'});}} className={`mt-3 ${control}`}>{busy?'正在建立目录…':'建立书籍目录'}</button>:<>
        <p className="mt-3 text-sm">书籍选段索引：已处理 {book.processedCount} / {book.unitCount} {label}，有文字 {book.readableCount}，待OCR {book.needsOcrCount}。</p>
        <p className="mt-1 text-xs text-textSub">{book.format==='EPUB'?'EPUB按书内阅读顺序使用全书稳定段号，不存在固定页码；图片、公式和复杂排版暂未展示。':book.unitKind==='paragraph'?'段落沿用原文空行分段，不是印刷页码。':'页码是PDF文件页码，不推测书上印刷页码。'}未处理范围不计入完成；原导入的文本块未改写。</p>
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">目录 · {book.chapters.length} 段</summary><ol className="max-h-72 space-y-2 overflow-auto">{book.chapters.map((chapter):ReactElement=><li key={chapter.id}><button type="button" disabled={busy} onClick={():void=>{void navigate(chapter.start);}} className={`${control} w-full break-words text-left`}><strong className="block">{chapter.title}</strong><span className="mt-1 block text-xs text-textSub">{chapter.start}–{chapter.end} {label} · {originLabel[chapter.origin]}</span></button></li>)}</ol></details>
        <details><summary className="min-h-11 cursor-pointer py-3 text-sm">校订目录</summary><label className="block text-xs text-textSub">每行：标题 | 起始{label} | 结束{label}<textarea aria-label="章节目录校订" value={draft} disabled={busy} onChange={(event):void=>setDraft(event.target.value)} className="mt-2 min-h-40 w-full rounded-xl border border-glass-line bg-bg p-3 text-sm text-text"/></label><button type="button" disabled={busy||draft===savedDraft} onClick={saveChapters} className={`mt-2 ${control}`}>保存目录校订</button></details>
        <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-0 text-xs">起始{label}<input type="number" aria-label={`提取起始${label}`} min="1" max={book.unitCount} value={start} disabled={busy} onChange={(event):void=>setStart(event.target.value)} className={`mt-1 block w-24 bg-bg ${control}`}/></label><label className="text-xs">结束{label}<input type="number" aria-label={`提取结束${label}`} min="1" max={book.unitCount} value={end} disabled={busy} onChange={(event):void=>setEnd(event.target.value)} className={`mt-1 block w-24 bg-bg ${control}`}/></label><button type="button" disabled={busy} onClick={():void=>{if(!validBookRange(Number(start),Number(end),book.unitCount)){setError('每次最多20页或段，请核对起止范围。');return;}void execute({action:'extract',start:Number(start),end:Number(end)});}} className={control}>{busy?'处理中…':'提取选段正文'}</button></div>
        <p className="mt-2 text-xs text-textSub">每次最多20{label}。扫描/空白PDF页会标记待OCR，本步骤不会用AI补写或调用识别服务。</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} className={control} onClick={():void=>{void navigate(book.cursor);}}>继续第 {book.cursor} {label}</button><button type="button" disabled={busy} className={control} onClick={():void=>{void execute(bookmarked?{action:'removeBookmark',position}:{action:'bookmark',position,label:`第 ${position} ${label}`});}}>{bookmarked?'取消此处书签':'添加此处书签'}</button>{book.unitKind==='page'&&<button type="button" disabled={busy} className={control} onClick={():void=>{void execute({action:'cursor',position});}}>记住当前页</button>}</div>
        <details><summary className="min-h-11 cursor-pointer py-3 text-sm">书签 · {book.bookmarks.length} 处</summary>{book.bookmarks.length?<div className="flex flex-wrap gap-2">{book.bookmarks.map((item):ReactElement=><button type="button" key={item.position} disabled={busy} className={control} onClick={():void=>{void navigate(item.position);}}>{item.label}</button>)}</div>:<p className="text-xs text-textSub">暂无书签。</p>}</details>
      </>}
      {error&&<p role="alert" className="mt-3 text-sm leading-6 text-rose">{error}</p>}{notice&&<p role="status" className="mt-3 text-sm leading-6 text-teal">{notice}</p>}
      <button type="button" disabled={busy||loading} onClick={():void=>{void reload();}} className={`mt-3 ${control}`}>重新读取书籍状态</button>
      {sourceUrl&&<a href={sourceUrl} target="_blank" rel="noreferrer" className={`mt-3 ml-2 inline-flex items-center ${control}`}>{book?.format==='EPUB'?'下载原EPUB':'原文件另开阅读'}</a>}
    </div>
    {book?<div className="border-b border-glass-line p-4"><Link className="inline-flex min-h-11 items-center rounded-xl border border-glass-line px-4 py-2 text-sm text-brand-ink" href={'/topics?'+new URLSearchParams({contentId,start:String(book.start),end:String(book.end)})}>用当前选段创建专题并提问 →</Link><p className="mt-2 text-xs text-textSub">在新页面明确保存范围并确认，不自动发送原文。</p></div>:null}
    {book?<details className="border-b border-glass-line p-4" onToggle={(event):void=>{if(event.currentTarget.open)setNotesMounted(true);}}><summary className="min-h-11 cursor-pointer py-3 font-semibold">章节笔记与摘录</summary>{notesMounted?<ReadingNotes contentId={contentId} book={book} onBusy={setNotesBusy} onSaved={():void=>{void books.read(contentId,book.start,book.end).then((result):void=>{if(mounted.current&&result.book)apply(result.book,false);}).catch(():void=>setError('笔记已保存，书籍版本读取失败，请重新读取书籍状态。'));}}/>:null}</details>:null}
    {book?.unitKind==='paragraph'?<div className="min-w-0 space-y-4 p-4 sm:p-5"><h3 className="font-semibold">原文段落 · {book.start}–{book.end}</h3>{book.readingUnits.some((unit):boolean=>!unit.value)&&<p className="text-sm leading-6 text-textSub">当前范围有 {book.readingUnits.filter((unit):boolean=>!unit.value).length} 段尚未提取，请用上方范围按钮读取。</p>}{book.readingUnits.filter((unit):boolean=>unit.value!==null).map((unit):ReactElement=><article key={unit.position} className="rounded-xl border border-glass-line p-3"><h4 className="mb-2 text-xs text-textSub">第 {unit.position} 段</h4><p className="whitespace-pre-wrap break-words text-sm leading-7">{unit.value?.status==='text'?unit.value.text:'此段尚未提取或没有可用文字，请选择上方范围提取。'}</p><button type="button" disabled={busy} className={`mt-2 ${control}`} onClick={():void=>{void navigate(unit.position);}}>从此段续读</button></article>)}<div className="flex flex-wrap gap-2"><button type="button" disabled={busy||book.start<=1} className={control} onClick={():void=>{void navigate(Math.max(1,book.start-20));}}>前20段</button><button type="button" disabled={busy||book.end>=book.unitCount} className={control} onClick={():void=>{void navigate(book.end+1);}}>后20段</button></div></div>:children}
    {book?.unitKind==='page'&&<details className="border-t border-glass-line p-4"><summary className="min-h-11 cursor-pointer py-3 text-sm">本次范围的PDF文本层 · {book.start}–{book.end} 页</summary>{book.readingUnits.map((unit):ReactElement=><article className="mt-3" key={unit.position}><h3 className="text-xs text-textSub">第 {unit.position} 页</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{unit.value?.status==='text'?unit.value.text:unit.value?.status==='needs-ocr'?'此页无可读文本层，待OCR或人工核对；不代表已识别成功。':'本页尚未提取。'}</p></article>)}</details>}
  </section>;
}
