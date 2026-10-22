'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';

import { AppShell } from '@/components/app/AppShell';
import { ContentStudyMeta } from '@/components/app/ContentStudyMeta';
import { TextImportPanel } from '@/components/import/TextImportPanel';
import { UrlImportPanel } from '@/components/import/UrlImportPanel';
import { CourseLibrary } from '@/components/courses/CourseLibrary';
import { defaultTitleFromFileName, validateUpload, type ContentTypeValue } from '@/lib/domain/content-format';
import { api, uploadToPresignedUrl, type ContentSummary } from '@/services/api';

type ImportMode = 'video' | 'image' | 'document';

type PipelineStage = { title: string; description: string };

const pipelineStages: Record<ImportMode, PipelineStage[]> = {
  video: [
    { title: '上传资料', description: '安全直传到你的学习空间' },
    { title: '抽取关键帧', description: '课堂视频每 2～5 秒取一帧' },
    { title: '关键帧筛选', description: '模型就绪后识别板书 / 屏幕教学内容 / 无效帧' },
    { title: 'OCR + ASR', description: '读取有效画面与语音时间点' },
    { title: 'AI 整理笔记', description: '生成可追溯的课堂笔记' },
  ],
  image: [
    { title: '上传图片', description: '安全直传到你的学习空间' },
    { title: '图片 OCR 与内容理解', description: '依次完成图像识别、文字提取和学习笔记整理' },
    { title: '学习笔记已就绪', description: '生成可追溯的学习笔记' },
  ],
  document: [
    { title: '上传文档', description: '安全直传到你的学习空间' },
    { title: '正文提取与内容理解', description: '读取文档文字与页码信息并整理学习笔记' },
    { title: '学习笔记已就绪', description: '生成可追溯的学习笔记' },
  ],
};

const modeDetails: Record<ImportMode, { title: string; description: string; icon: string; contentType: ContentTypeValue }> = {
  video: { title: '课堂视频', description: '录屏、讲座或教学视频', icon: '▶', contentType: 'video' },
  image: { title: '图片资料', description: '板书、课件或笔记照片', icon: '▧', contentType: 'document' },
  document: { title: '文档导入', description: 'PDF、EPUB、Markdown 或 TXT', icon: '▤', contentType: 'document' },
};

const statusClass: Record<ContentSummary['status'], string> = {
  '待导入': 'text-textSub',
  '上传中': 'text-amber',
  '解析中': 'text-teal',
  '已就绪': 'text-brand-ink',
  '失败': 'text-rose',
};

function accepts(mode: ImportMode): string {
  if (mode === 'video') return 'video/mp4,video/quicktime,video/webm,video/x-matroska';
  if (mode === 'image') return '.png,.jpg,.jpeg';
  return '.pdf,.epub,.md,.txt';
}

export default function ImportPage(): ReactElement {
  const [space, setSpace] = useState<'mine' | 'shared'>('mine');
  const [inputMode,setInputMode]=useState<'file'|'url'|'text'>('file');
  const [importOpen, setImportOpen] = useState(true);
  const [uploadStarted, setUploadStarted] = useState(false);
  const [mode, setMode] = useState<ImportMode>('video');
  const [file, setFile] = useState<File | null>(null);
  const visibleStages: PipelineStage[] = mode === 'document' && file?.name.toLowerCase().endsWith('.epub') ? [{title:'上传电子书',description:'上传本人有权使用的无DRM EPUB'}, {title:'安全验证与目录解析',description:'检查格式、阅读顺序和正文；不执行书内资源'}, {title:'章节阅读已就绪',description:'进入学习后选段提取正文并记个人笔记；尚未AI整理'}] : pipelineStages[mode];
  const pendingUpload = useRef<{ file: File; contentId: string } | null>(null);
  const uploadPending = useRef(false);
  const [items, setItems] = useState<ContentSummary[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const visibleItems = items.filter((item) => (!filter || item.contentType === filter) && item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const [phase, setPhase] = useState('选择资料后开始上传');
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleting, setDeleting] = useState<ContentSummary | null>(null);
  const [contentBusy, setContentBusy] = useState(false);
  const mutationPending = useRef(false);
  const loadSequence = useRef(0);
  const pollTimer = useRef<number | null>(null);
  const activePollId = useRef<string | null>(null);
  const mounted = useRef(false);

  const stopPolling = (): void => {
    activePollId.current = null;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const load = (): void => {
    const sequence = ++loadSequence.current;
    setListLoading(true); setListError('');
    void api.contents().then((result) => { if (mounted.current && sequence === loadSequence.current) setItems(result.items); }).catch((reason: unknown) => { if (mounted.current && sequence === loadSequence.current) setListError(reason instanceof Error ? reason.message : '资料加载失败，请刷新重试'); }).finally(() => { if (mounted.current && sequence === loadSequence.current) setListLoading(false); });
  };

  const saveTitle = async (id: string): Promise<void> => {
    if (mutationPending.current || !editTitle.trim()) return;
    mutationPending.current = true; setContentBusy(true); setListError('');
    try {
      const updated = await api.updateContent(id, editTitle.trim());
      setItems((current) => current.map((item) => item.contentId === id ? updated : item));
      setEditingId(null);
    } catch (reason) { setListError(reason instanceof Error ? reason.message : '改名失败，输入已保留'); }
    finally { mutationPending.current = false; setContentBusy(false); }
  };

  const removeContent = async (): Promise<void> => {
    if (!deleting || mutationPending.current) return;
    const id = deleting.contentId;
    mutationPending.current = true; setContentBusy(true); setListError('');
    try {
      await api.deleteContent(id);
      if (activePollId.current === id) { stopPolling(); setBusy(false); setPhase('资料已删除'); }
      setItems((current) => current.filter((item) => item.contentId !== id));
      setDeleting(null); if (editingId === id) setEditingId(null);
    } catch (reason) { setListError(reason instanceof Error ? reason.message : '删除失败，请重试'); }
    finally { mutationPending.current = false; setContentBusy(false); }
  };

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      stopPolling();
    };
  }, []);

  const selectMode = (nextMode: ImportMode): void => {
    if (uploadPending.current) return;
    pendingUpload.current = null;
    stopPolling();
    setMode(nextMode);
    setUploadStarted(false);
    setFile(null);
    setError('');
    setStageIndex(0);
    setPhase(`已选择${modeDetails[nextMode].title}，请添加资料`);
  };

  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    if (uploadPending.current) return;
    pendingUpload.current = null;
    stopPolling();
    const next = event.target.files?.[0] ?? null;
    setUploadStarted(false);
    setFile(next);
    setError('');
    setStageIndex(0);
    setPhase(next ? `已选择：${next.name}` : '选择资料后开始上传');
  };

  const poll = (contentId: string, importMode: ImportMode, delayMs = 2_000): void => {
    if (activePollId.current !== contentId) return;
    pollTimer.current = window.setTimeout(() => {
      pollTimer.current = null;
      void api.content(contentId).then((content) => {
        if (activePollId.current !== contentId) return;
        setItems((current) => current.map((item) => item.contentId === contentId ? content : item));
        if (content.status === '失败') {
          setStageIndex(1);
          setPhase(importMode === 'video' ? '视频解析失败，请检查文件或解析服务后重试' : importMode === 'image' ? '图片处理失败，请查看服务日志后重试' : '文档解析失败，请检查文件后重试');
          setBusy(false);
          stopPolling();
          return;
        }
        if (content.status !== '已就绪') {
          setStageIndex(1);
          setPhase(importMode === 'video' ? '正在抽取视频信息与关键帧…' : importMode === 'image' ? '正在准备图片识别…' : '正在读取文档内容…');
          poll(contentId, importMode);
          return;
        }
        if (content.format === 'EPUB') {
          setStageIndex(pipelineStages[importMode].length - 1);
          setPhase('EPUB目录已就绪，可进入学习后选段提取正文；尚未AI整理。');
          setBusy(false); stopPolling(); return;
        }
        if (content.understandingStatus === 'completed') {
          setStageIndex(pipelineStages[importMode].length - 1);
          setPhase('AI 整理笔记已完成，可以开始学习');
          setBusy(false);
          stopPolling();
          return;
        }
        setStageIndex(importMode === 'video' ? 3 : 1);
        if (content.understandingStatus === 'failed') {
          setPhase('AI 整理失败，原资料仍可学习');
          setBusy(false);
          stopPolling();
          return;
        }
        setPhase(content.understandingStatus === 'none'
          ? '资料已就绪，正在等待 AI 理解任务启动…'
          : importMode === 'image' ? '图片已就绪，正在进行图像识别与内容理解…' : importMode === 'document' ? '文档已读取，AI 正在后台整理笔记…' : '文件已可学习，AI 正在后台整理笔记');
        setBusy(false);
        poll(contentId, importMode);
      }).catch(() => {
        if (activePollId.current !== contentId) return;
        setPhase('暂时无法获取处理进度，正在重试…');
        setBusy(false);
        poll(contentId, importMode, Math.min(delayMs * 2, 10_000));
      });
    }, delayMs);
  };

  const upload = async (): Promise<void> => {
    if (uploadPending.current || busy) return;
    if (!file) {
      setError('请先选择要导入的资料');
      return;
    }
    const contentType = modeDetails[mode].contentType;
    const validation = validateUpload(contentType, file.name, file.size);
    if (!validation.ok) {
      setError(validation.reason === 'FILE_TOO_LARGE' ? '文件超过该类型的大小限制' : '该资料格式暂不支持');
      return;
    }
    uploadPending.current = true;
    stopPolling();
    setBusy(true);
    setUploadStarted(true);
    setError('');
    try {
      setStageIndex(0);
      setPhase(`正在为${modeDetails[mode].title}创建安全上传通道…`);
            const previous = pendingUpload.current?.file === file ? pendingUpload.current : null;
      if (previous) {
        const current = await api.content(previous.contentId);
        if (current.status === '解析中' || current.status === '已就绪') {
          if (!mounted.current) return;
          setPhase('原资料已进入处理，正在恢复进度…');
          activePollId.current = previous.contentId; poll(previous.contentId, mode); load(); return;
        }
      }
      const intent = await api.createUploadIntent({ ...(previous ? { contentId: previous.contentId } : {}), contentType, fileName: file.name, fileSize: file.size, mimeType: file.type || 'application/octet-stream' });
      pendingUpload.current = { file, contentId: intent.contentId };
      if (!mounted.current) return;
      setPhase('正在上传资料…');
      await uploadToPresignedUrl(intent.uploadUrl, file);
      setStageIndex(1);
      setPhase(mode === 'video' ? '视频已上传，正在启动课堂解析…' : mode === 'image' ? '图片已上传，正在启动图像识别…' : '文档已上传，正在读取内容…');
      await api.completeUpload(intent.contentId, { size: file.size, title: defaultTitleFromFileName(file.name) });
      if (!mounted.current) return;
      load();
      activePollId.current = intent.contentId;
      poll(intent.contentId, mode);
    } catch (reason) {
      if (!mounted.current) return;
      stopPolling();
      setBusy(false);
      setError(reason instanceof Error ? reason.message : '导入失败，请重试');
      setPhase('导入失败');
    } finally { uploadPending.current = false; }
  };

  return <AppShell compactNavigation title="学习中心" subtitle="导入资料、查看处理进度，并从这里进入学习。">
    <div role="group" aria-label="学习中心资料空间" className="shared-course-actions mb-5"><button className="learner-text-action" aria-pressed={space === 'mine'} onClick={(): void => setSpace('mine')}>我的资料</button><button className="learner-text-action" aria-pressed={space === 'shared'} onClick={(): void => setSpace('shared')}>共享课程</button></div>
    {space === 'shared' ? <CourseLibrary /> : null}
    <div hidden={space !== 'mine'}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">学习中心</h1><p className="mt-2 text-sm text-textSub">左侧管理和学习已有资料，右侧导入新资料；窄屏依次显示。</p></div><button type="button" aria-expanded={importOpen} aria-controls="content-import-panel" disabled={busy} onClick={() => setImportOpen((value) => !value)} className="min-h-11 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{importOpen ? '收起导入' : '导入新资料'}</button></div>

    <div className={`learning-center-columns ${importOpen ? "has-import" : ""}`}><div className="learning-center-library">
    <div className="mb-5 flex flex-wrap gap-3"><label className="flex min-w-0 flex-1 flex-wrap items-center gap-2">搜索资料<input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 w-full min-w-0 flex-1 rounded-lg border p-2" placeholder="输入资料标题" /></label><label className="flex flex-wrap items-center gap-2">资料类型<select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-h-11 rounded-lg border p-2"><option value="">全部类型</option><option value="video">课堂视频</option><option value="document">图文资料</option></select></label></div>
    <section id="learning-library" aria-labelledby="learning-library-title" className="rounded-xl border border-glass-line bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4"><div><h2 id="learning-library-title" className="font-semibold">我的资料</h2><p className="mt-1 text-sm text-textSub">资料就绪后即可学习；AI笔记以实际状态为准，选段整理需另行确认。</p></div><button type="button" onClick={load} disabled={listLoading || contentBusy} className="min-h-11 rounded-lg border border-glass-line px-3 py-2 text-sm text-brand-ink">刷新</button></div>
      {listError ? <p role="alert" className="mt-4 text-sm text-rose">{listError}</p> : null}
      {listLoading ? <p role="status" className="mt-5 text-textSub">正在加载学习资料…</p> : !listError && visibleItems.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-glass-line p-6 text-center text-sm text-textSub">{items.length === 0 ? <><p>还没有学习资料，先导入一份吧。</p><button type="button" onClick={() => setImportOpen(true)} className="mt-3 min-h-11 rounded-lg bg-brand-soft px-4 py-2 text-brand-ink">导入第一份资料</button></> : <p>暂无符合条件的资料，请更换搜索或筛选条件。</p>}</div> : <div className="mt-5 grid gap-3">{visibleItems.map((item) => <article key={item.contentId} className="min-w-0 rounded-xl border border-glass-line bg-bg p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><span className="text-xs text-textMute">{item.contentType === "video" ? "课堂视频" : "图文资料"}</span><h3 className="mt-1 break-words font-medium">{item.title}</h3><p className={"mt-2 text-xs " + statusClass[item.status]}>资料：{item.status}</p></div>{item.status === "已就绪" ? <Link href={"/study/" + encodeURIComponent(item.contentId)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-brand-soft px-3 py-2 text-xs font-medium text-brand-ink">进入学习</Link> : <span className="shrink-0 text-xs text-textMute">{item.status === "失败" || item.status === "待导入" ? "需重新导入" : "处理中"}</span>}</div>
        <ContentStudyMeta item={item} />
        {editingId === item.contentId ? <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveTitle(item.contentId); }}><label className="flex-1 text-sm">资料标题<input disabled={contentBusy} required maxLength={100} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><button disabled={contentBusy || !editTitle.trim()} className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-ink">保存标题</button><button type="button" disabled={contentBusy} onClick={() => setEditingId(null)} className="px-3 text-sm">取消改名</button></form> : <div className="mt-3 flex gap-4 text-sm"><button type="button" disabled={contentBusy || busy} onClick={() => { setEditingId(item.contentId); setEditTitle(item.title); setListError(""); }} className="text-brand-ink">改名</button><button type="button" disabled={contentBusy || busy} onClick={() => { setDeleting(item); setListError(""); }} className="text-rose">删除资料</button></div>}
      </article>)}</div>}
    </section>
    {!importOpen && uploadStarted ? <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-glass-line bg-surface p-4"><p role="status" className="text-sm text-textSub">{phase}</p><button type="button" onClick={() => setImportOpen(true)} className="min-h-11 rounded-lg bg-brand-soft px-4 py-2 text-sm text-brand-ink">查看处理进度</button></section> : null}
    </div>
    <div id="content-import-panel" hidden={!importOpen} className="min-w-0">
    <h2 className="mb-4 text-lg font-semibold">导入资料</h2><p className="mb-4 text-sm leading-6 text-textSub">导入后进入学习：书籍/文章先选段提取，再记笔记、摘录；需要跨资料提问时进入“专题学习”。视频按已有解析进度学习。</p>
    <div className="mb-4 flex flex-wrap gap-2">{(['file','url','text'] as const).map((value)=><button key={value} type="button" aria-pressed={inputMode===value} disabled={busy} onClick={()=>setInputMode(value)} className={`min-h-11 rounded-xl border px-4 py-2 text-sm ${inputMode===value?'border-brand bg-brand-soft text-brand-ink':'border-glass-line bg-surface'}`}>{value==='file'?'上传文件':value==='url'?'公开链接':'粘贴正文'}</button>)}</div>
    <div hidden={inputMode!=='text'}><TextImportPanel onSaved={load}/></div>
    <div hidden={inputMode!=='url'}><UrlImportPanel onSaved={load}/></div>
    <div hidden={inputMode!=='file'}><div className="grid min-w-0 gap-5">
      <section className="rounded-xl border border-glass-line bg-surface p-6 shadow-sm">
        <div className="flex items-start gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-lg text-brand-ink">✦</span><div><h2 className="font-semibold">把课堂资料交给文豪</h2><p className="mt-1 text-sm leading-6 text-textSub">{mode === 'video' ? '视频会优先经过 MindSpore 关键帧筛选；只有有价值的课堂画面再进入 OCR 与 AI 整理。' : mode === 'image' ? '图片直接进入图像识别与 OCR，再由 AI 整理为可追溯的学习笔记。' : '文档先提取正文与页码信息，再由 AI 整理为可追溯的学习笔记。'}</p></div></div>
        <div className="learning-center-modes mt-6 grid gap-3">{(Object.keys(modeDetails) as ImportMode[]).map((itemMode) => <button type="button" key={itemMode} onClick={() => selectMode(itemMode)} disabled={busy} className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${mode === itemMode ? 'border-brand bg-brand-soft shadow-sm' : 'border-glass-line bg-bg hover:-translate-y-0.5 hover:border-brand/60'}`}><span className="grid h-9 w-9 place-items-center rounded-lg bg-white/70 text-lg text-brand-ink">{modeDetails[itemMode].icon}</span><strong className="mt-3 block text-sm">{modeDetails[itemMode].title}</strong><small className="mt-1 block leading-5 text-textSub">{modeDetails[itemMode].description}</small>{itemMode === 'video' ? <span className="mt-3 inline-block rounded-full bg-brand px-2 py-0.5 text-[10px] font-medium text-bg">MindSpore 主角能力</span> : null}</button>)}</div>
        <label className="mt-5 block rounded-xl border border-dashed border-glass-line bg-bg p-5 text-center transition hover:border-brand"><span className="text-sm font-medium text-brand-ink">选择{modeDetails[mode].title}文件</span><span className="mt-1 block text-xs text-textSub">{mode === 'video' ? 'MP4、MOV、WebM 或 MKV' : mode === 'image' ? 'PNG、JPG 或 JPEG' : 'PDF、EPUB、Markdown 或 TXT'}</span><input key={mode} type="file" accept={accepts(mode)} onChange={choose} disabled={busy} className="sr-only" /></label>
        {file ? <p className="mt-4 break-words rounded-lg bg-brand-soft px-3 py-2 text-xs text-textSub">已选择：{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p> : null}
        {error ? <p className="mt-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p> : null}
        <button type="button" onClick={() => void upload()} disabled={busy} className="mt-5 w-full rounded-xl bg-brand px-4 py-3 font-semibold text-bg shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '正在处理…' : mode === 'document' ? '开始导入文档' : `开始导入${modeDetails[mode].title}`}</button>
        <p className="mt-3 text-center text-xs leading-5 text-textMute">请仅导入自己拥有或已获得授权的学习资料。</p>
      </section>
      <section className="rounded-xl border border-glass-line bg-surface p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{mode === 'video' ? '自动课堂笔记流程' : mode === 'image' ? '图片识别与笔记流程' : '文档解析与笔记流程'}</h2><p className="mt-1 text-sm text-textSub">{phase}</p></div><span className="rounded-full bg-brand-soft px-3 py-1 text-xs text-brand-ink">{uploadStarted ? `${Math.min(stageIndex + 1, pipelineStages[mode].length)} / ${pipelineStages[mode].length}` : '待开始'}</span></div><ol className="mt-6 space-y-3">{visibleStages.map((stage, index) => <li key={stage.title} className={`flex gap-3 rounded-xl border p-3 ${uploadStarted && index < stageIndex ? 'border-teal/40 bg-teal-soft' : uploadStarted && index === stageIndex ? 'border-brand bg-brand-soft' : 'border-glass-line bg-bg'}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${uploadStarted && index < stageIndex ? 'bg-teal text-bg' : uploadStarted && index === stageIndex ? 'bg-brand text-bg' : 'bg-white/70 text-textMute'}`}>{uploadStarted && index < stageIndex ? '✓' : index + 1}</span><div><strong className="text-sm">{stage.title}</strong><p className="mt-0.5 text-xs leading-5 text-textSub">{stage.description}</p></div></li>)}</ol>{mode === 'video' ? <div className="mt-5 rounded-xl border border-dashed border-glass-line p-4"><p className="text-sm font-medium">为什么要先筛选？</p><p className="mt-1 text-xs leading-5 text-textSub">三分类模型可识别板书、屏幕教学内容（含 PPT、PDF、代码）和无效帧，高置信无效帧跳过 OCR；推理服务不可用时使用均匀抽帧保底，模型是否运行以本次实际处理结果为准。</p></div> : null}</section>
    </div></div>
    </div>
    </div>
    {deleting ? <section role="dialog" aria-modal="true" aria-labelledby="delete-content-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"><div className="w-full max-w-md rounded-2xl border border-glass-line bg-surface p-6 shadow-xl"><h2 id="delete-content-title" className="font-semibold">确认删除资料？</h2><p className="mt-3 text-sm leading-6">将删除「{deleting.title}」及其笔记、闪卡、练习记录和学习计划，删除后无法恢复。</p>{listError ? <p role="alert" className="mt-3 text-rose">{listError}</p> : null}<div className="mt-5 flex gap-4"><button type="button" disabled={contentBusy} onClick={() => void removeContent()} className="rounded-lg bg-rose-soft px-4 py-2 text-rose">确认删除</button><button type="button" disabled={contentBusy} onClick={() => setDeleting(null)} className="rounded-lg border px-4 py-2">保留资料</button></div></div></section> : null}
    </div>
  </AppShell>;
}
