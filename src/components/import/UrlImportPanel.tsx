'use client';
import Link from 'next/link';
import {useEffect,useRef,useState,type ReactElement} from 'react';
import {urlImports} from '@/services/url-imports';
import type {UrlDraftView} from '@/lib/url-imports/contracts';
import {VideoUrlImportPanel} from './VideoUrlImportPanel';
const storageKey='learning-url-preview-id';
const control='min-h-11 rounded-xl border border-glass-line px-4 py-2 text-sm disabled:opacity-50';
function DocumentUrlImportPanel({onSaved}:{onSaved:()=>void}):ReactElement{
  const [url,setUrl]=useState(''),[draft,setDraft]=useState<UrlDraftView|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const current=useRef<string|null>(null),controller=useRef<AbortController|null>(null),sequence=useRef(0),pending=useRef(false),mounted=useRef(true);
  const apply=(value:UrlDraftView):void=>{setDraft(value);setChecked(false);if(value.state==='COMMITTED')onSaved();};
  useEffect(()=>{mounted.current=true;const version=++sequence.current;const id=sessionStorage.getItem(storageKey);if(id){current.current=id;void urlImports.read(id).then((value):void=>{if(mounted.current&&sequence.current===version)apply(value);}).catch(():void=>{if(mounted.current&&sequence.current===version)setError('上次预览暂无法读取，请重读状态或清除本机预览编号。');});}return():void=>{mounted.current=false;sequence.current++;controller.current?.abort();};},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const run=async(action:()=>Promise<UrlDraftView>,commit=false):Promise<void>=>{if(pending.current)return;pending.current=true;setBusy(true);setSaving(commit);setError('');const version=++sequence.current;try{const value=await action();if(mounted.current&&version===sequence.current)apply(value);}catch{if(mounted.current&&version===sequence.current)setError('请求未确认完成。请重新读取状态，避免重复保存；原资料不受影响。');}finally{if(mounted.current&&version===sequence.current){setBusy(false);setSaving(false);pending.current=false;}}};
  const preview=():void=>{if(pending.current||current.current)return;const id=crypto.randomUUID();current.current=id;sessionStorage.setItem(storageKey,id);controller.current=new AbortController();void run(()=>urlImports.preview(id,url,controller.current!.signal));};
  const cancel=async():Promise<void>=>{if(saving||!current.current)return;controller.current?.abort();sequence.current++;pending.current=false;setBusy(false);const id=current.current;await run(()=>urlImports.cancel(id));};
  const reset=():void=>{if(busy)return;current.current=null;sessionStorage.removeItem(storageKey);setDraft(null);setChecked(false);setError('');};
  const active=draft?.state==='PREVIEW'||draft?.state==='FETCHING';
  return <section className="min-w-0 space-y-4 rounded-xl border border-glass-line bg-surface p-5 shadow-sm">
    <div><h3 className="font-semibold">公开链接导入</h3><p className="mt-2 text-sm leading-6 text-textSub">先预览，再保存到我的资料。支持公开静态文章及直接 PDF；登录、网盘、动态或视频页面请改用文件上传。</p></div>
    <label className="block text-sm">文章或 PDF 链接<input aria-label="文章或PDF链接" type="url" value={url} disabled={busy||current.current!==null} onChange={(event)=>setUrl(event.target.value)} placeholder="https://…" className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-glass-line bg-bg px-3"/></label>
    <p className="text-xs leading-5 text-textMute">HTML 最大 2 MB，PDF 最大 10 MB，获取限时 30 秒；预览保留 30 分钟，仅当前账号可见。请只保存有权使用的内容。</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!url.trim()||current.current!==null} onClick={preview} className={control+' bg-brand text-white'}>{busy&&!saving?'正在读取…':'获取预览'}</button>{current.current?<button type="button" disabled={busy} onClick={()=>void run(()=>urlImports.read(current.current!))} className={control}>重新读取状态</button>:null}{(active||busy&&!saving||current.current&&!draft)?<button type="button" disabled={saving} onClick={()=>void cancel()} className={control}>取消预览</button>:null}</div>
    {error?<p role="alert" className="text-sm text-rose">{error}</p>:null}
    {draft?<div role="status" className="text-sm text-textSub">{({FETCHING:'正在获取，可稍后重新读取状态',PREVIEW:'预览已就绪，尚未加入我的资料',FAILED:'预览失败',CANCELLED:'已取消预览',EXPIRED:'预览已过期',COMMITTED:'快照已保存'})[draft.state]}{draft.error?<p className="mt-2 text-rose">{draft.error}</p>:null}</div>:null}
    {draft?.preview?<div className="min-w-0 space-y-3 border-t border-glass-line pt-4"><h4 className="font-semibold">{draft.preview.source.title}</h4><dl className="space-y-2 break-words text-xs leading-5 text-textSub"><div>格式：{draft.preview.format} · {draft.preview.units} {draft.preview.format==='PDF'?'页':'段'} · {draft.preview.chapters} 个目录项</div><div className="break-all">原链接：{draft.preview.source.requestedUrl}</div><div className="break-all">最终链接：{draft.preview.source.finalUrl}</div><div>作者：{draft.preview.source.author??'来源未提供'}；发布时间：{draft.preview.source.publishedLabel??'来源未提供'}</div><div>获取时间：{new Date(draft.preview.source.fetchedAt).toLocaleString()}</div></dl><p className="text-xs text-textMute">{draft.preview.previewRange}；仅正文预览，尚未 AI 整理。PDF 无文本层时仍可保存原页阅读。</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-bg p-4 font-sans text-sm leading-7">{draft.preview.excerpt||'本范围没有可提取文本，请保存后查看原页。'}</pre>
    {draft.existing.length?<p className="text-sm text-textSub">已有相同内容：{draft.existing.map((item)=>item.title).join('、')}。可复用已有资料，或明确另存副本。</p>:null}
    <label className="flex min-h-11 items-start gap-2 text-sm leading-6"><input type="checkbox" checked={checked} disabled={busy} onChange={(event)=>setChecked(event.target.checked)} className="mt-1"/>我已核对来源与预览，确认保存此快照；之后原网页变化不会覆盖我的资料。</label>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!checked} onClick={()=>void run(()=>urlImports.confirm(current.current!,'reuse'),true)} className={control+' bg-brand text-white'}>{saving?'正在保存…':draft.existing.length?'复用已有资料':'保存到我的资料'}</button>{draft.existing.length?<button type="button" disabled={busy||!checked} onClick={()=>void run(()=>urlImports.confirm(current.current!,'new'),true)} className={control}>另存副本</button>:null}</div></div>:null}
    {draft?.state==='COMMITTED'&&draft.contentId?<Link className={control+' inline-flex items-center bg-brand-soft text-brand-ink'} href={'/study/'+encodeURIComponent(draft.contentId)}>进入学习</Link>:null}
    {!busy&&current.current&&!active?<button type="button" onClick={reset} className={control}>清除本机编号，开始新的预览</button>:null}
  </section>;
}

export function UrlImportPanel({onSaved}:{onSaved:()=>void}):ReactElement{
  const [mode,setMode]=useState<'document'|'video'>('document');
  return <div className="min-w-0 space-y-4"><div role="group" aria-label="链接内容类型" className="flex flex-wrap gap-2">{(['document','video'] as const).map((value)=><button key={value} type="button" aria-pressed={mode===value} onClick={():void=>setMode(value)} className={control+(mode===value?' border-brand bg-brand-soft text-brand-ink':' bg-surface')}>{value==='document'?'文章 / PDF':'视频直链'}</button>)}</div><div hidden={mode!=='document'}><DocumentUrlImportPanel onSaved={onSaved}/></div><div hidden={mode!=='video'}><VideoUrlImportPanel onSaved={onSaved}/></div></div>;
}
