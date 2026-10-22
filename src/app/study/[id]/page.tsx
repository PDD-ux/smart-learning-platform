'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { isRoutePromise } from '@/lib/domain/route-params';

import { BookReader } from '@/components/study/BookReader';
import { AppShell } from '@/components/app/AppShell';
import { WatchedNotes } from '@/components/study/WatchedNotes';
import { PlaybackNotes } from '@/components/study/PlaybackNotes';
import { StudyNextSteps } from '@/components/study/StudyNextSteps';
import { resolveStudyLocation, type StudySearchParams } from '@/lib/domain/study-location';
import { api, ApiClientError, type ContentSummary, type GeneratedNote, type NoteItem, type Progress, type Resource, type Understanding } from '@/services/api';

function refLabel(ref: NoteItem['ref'], format?: string): string {
  if(ref.type === 'document' && ref.blockIndex !== undefined && ['TXT','MD','EPUB'].includes(format?.toUpperCase()??'')) return `原文第 ${ref.blockIndex+1} 段`;
  return ref.type === 'video' ? `${Math.floor(ref.timestampSec / 60)}:${String(ref.timestampSec % 60).padStart(2, '0')}` : `第 ${ref.page} 页`;
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type ReadPart = 'understanding' | 'generatedNote' | 'status' | 'progress';
type ReadStatus = 'loading' | 'ready' | 'failed';
const readLabels: Record<ReadPart, string> = { understanding: '解析依据', generatedNote: 'AI 笔记', status: '处理状态', progress: '续学位置' };
const phaseLabels: Record<string, string> = { none: '尚未开始 AI 整理', 'light-filter': '关键帧筛选中', 'deep-extract': 'OCR / ASR 提取中', 'product-gen': '生成学习产物中', completed: 'AI 整理已完成', failed: 'AI 整理失败' };

function isUsefulDocumentText(text: string): boolean {
  const normalized = text.replace(/\s/g, '');
  return normalized.length >= 12 && (/[一-鿿]{2}/.test(normalized) || /(?:[A-Za-z]{4,}\s+){2}[A-Za-z]{4,}/.test(text)) && !/^[.。·…_—-]+$/.test(normalized);
}

function StudyWorkspace({ searchParams = {} }: { searchParams?: StudySearchParams }): ReactElement {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const contentId = params.id;
  const isStudyLanding = contentId === 'demo';
  const [content, setContent] = useState<ContentSummary | null>(null);
  const [availableContents, setAvailableContents] = useState<ContentSummary[]>([]);
  const [showStudyLanding, setShowStudyLanding] = useState(false);
  const [resource, setResource] = useState<Resource | null>(null);
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  const [generatedNote, setGeneratedNote] = useState<GeneratedNote | null>(null);
  const [activeNotePanel, setActiveNotePanel] = useState<'ai' | 'manual'>('ai');
  const [isRegeneratingNote, setIsRegeneratingNote] = useState(false);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [phase, setPhase] = useState('none');
  const lastPhase = useRef('none');
  const [reads, setReads] = useState<Record<ReadPart, ReadStatus>>({ understanding: 'loading', generatedNote: 'loading', status: 'loading', progress: 'loading' });
  const readVersions = useRef<Record<ReadPart, number>>({ understanding: 0, generatedNote: 0, status: 0, progress: 0 });
  const mounted = useRef(true);
  const loadVersion = useRef(0);
  const reading = useRef<Record<ReadPart, boolean>>({ understanding: false, generatedNote: false, status: false, progress: false });
  const [understandingFailureReason, setUnderstandingFailureReason] = useState('');
  const [noteText, setNoteText] = useState('');
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [autoSavedNote, setAutoSavedNote] = useState<NoteItem | null>(null);
  const [noteSaveStatus, setNoteSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState<{ answer: string; citations: Array<{ ref: NoteItem['ref']; excerpt: string }> } | null>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentBlock, setDocumentBlock] = useState<number | undefined>(undefined);
  const [documentAnchor, setDocumentAnchor] = useState<number | undefined>(undefined);
  const [failedPdfPage, setFailedPdfPage] = useState<number | null>(null);
  const [videoPosition, setVideoPosition] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoSeekVersion, setVideoSeekVersion] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const parsedNotesRef = useRef<HTMLDetailsElement>(null);
  const lastHeartbeat = useRef(0);
  const lastDocumentSave = useRef(0);
  const lastAutoSavedText = useRef('');
  const notePending = useRef(false);
  const draftRef = useRef<NoteItem['ref'] | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const initialLocation = content ? resolveStudyLocation(searchParams, content) : null;
  const citationTime = initialLocation?.type === 'video' ? initialLocation.timestampSec : null;
  const citationPage = initialLocation?.type === 'document' ? initialLocation.page : null;
  const citationBlock = initialLocation?.type === 'document' ? initialLocation.blockIndex : undefined;

  const readPart = useCallback(async function read(part: ReadPart, background = false): Promise<void> {
    if (background && reading.current[part]) return;
    reading.current[part] = true;
    const version = ++readVersions.current[part];
    if (!background) setReads((value) => ({ ...value, [part]: 'loading' }));
    const active = (): boolean => mounted.current && readVersions.current[part] === version;
    try {
      if (part === 'understanding') { const result = await api.understanding(contentId); if (active()) setUnderstanding(result); }
      else if (part === 'generatedNote') { const result = await api.generatedNote(contentId); if (active()) setGeneratedNote(result.note); }
      else if (part === 'progress') {
        const result = await api.progress(contentId);
        if (active()) { setProgress(result); if (result.contentType === 'document') setDocumentPage(result.page); }
      } else {
        const result = await api.understandingStatus(contentId);
        if (active()) {
          const transitioned = lastPhase.current !== 'none' && lastPhase.current !== result.phase;
          lastPhase.current = result.phase;
          setPhase(result.phase); setUnderstandingFailureReason(result.failureReason ?? '');
          if ((background || transitioned) && (result.phase === 'completed' || result.phase === 'failed')) void Promise.all([read('understanding'), read('generatedNote')]);
        }
      }
      if (active()) setReads((value) => ({ ...value, [part]: 'ready' }));
    } catch { if (active()) setReads((value) => ({ ...value, [part]: 'failed' })); }
    finally { if (active()) reading.current[part] = false; }
  }, [contentId]);

  const load = useCallback(async (): Promise<void> => {
    const version = ++loadVersion.current;
    const active = (): boolean => mounted.current && loadVersion.current === version;
    setLoadFailed(false); setNotesLoaded(false); setError('');
    try {
      if (isStudyLanding) {
        const result = await api.contents();
        if (!active()) return;
        setAvailableContents(result.items);
        const firstReady = result.items.find((item) => item.status === '已就绪');
        if (firstReady) {
          router.replace(`/study/${firstReady.contentId}`);
          return;
        }
        setShowStudyLanding(true);
        return;
      }
      const current = await api.content(contentId);
      if (!active()) return;
      setContent(current);
      if (current.status !== '已就绪') return;
      await Promise.all([
        api.resource(contentId).then((result) => { if (active()) setResource(result); }).catch(() => { if (active()) { setLoadFailed(true); setError('原资料加载失败，请重试；已保存的笔记不会删除。'); } }),
        api.notes(contentId).then((result) => { if (active()) { setNotes(result.items); setNotesLoaded(true); } }).catch(() => { if (active()) { setLoadFailed(true); setError('个人笔记加载失败，请重新加载后再编辑。'); } }),
        readPart('understanding'), readPart('progress'), readPart('status'), readPart('generatedNote'),
      ]);
    } catch (reason) {
      if (!active()) return;
      setLoadFailed(true);
      setError(reason instanceof Error ? reason.message : '内容加载失败');
    }
  }, [contentId, isStudyLanding, router, readPart]);

  useEffect(() => { mounted.current = true; const versions = readVersions.current; void load(); return () => { mounted.current = false; loadVersion.current += 1; for (const part of Object.keys(versions) as ReadPart[]) versions[part] += 1; }; }, [load]);

  useEffect(() => {
    if (citationPage !== null) setDocumentPage(citationPage);
  }, [citationPage, progress]);

  useEffect(() => {
    if (phase === 'completed' || phase === 'failed' || phase === 'none') return;
    const timer = window.setInterval(() => {
      void readPart('status', true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [contentId, phase, readPart]);

  const saveVideoProgress = async (positionSec: number): Promise<void> => {
    if (reads.progress !== 'ready') return;
    if (Math.abs(positionSec - lastHeartbeat.current) < 5 && positionSec !== 0) return;
    lastHeartbeat.current = positionSec;
    await api.saveProgress(contentId, { contentType: 'video', positionSec }).catch(() => undefined);
  };

  const saveDocumentProgress = async (page: number, scrollRatio: number): Promise<void> => {
    if (reads.progress !== 'ready') return;
    const now = Date.now();
    if (now - lastDocumentSave.current < 5000) return;
    lastDocumentSave.current = now;
    await api.saveProgress(contentId, { contentType: 'document', page, scrollRatio }).catch(() => undefined);
  };

  useEffect(() => {
    if (resource?.contentType === 'video' && progress?.contentType === 'video' && videoRef.current && Number.isFinite(progress.positionSec)) {
      const position = citationTime ?? progress.positionSec;
      if (videoRef.current.readyState > 0) videoRef.current.currentTime = position;
      setVideoPosition(position);
    }
  }, [resource, progress, citationTime]);

  const jumpToRef = (ref: NoteItem['ref']): void => {
    if (ref.type === 'video') {
      if (videoRef.current) {
        videoRef.current.currentTime = ref.timestampSec;
        setVideoPosition(ref.timestampSec);
        void videoRef.current.play().catch(() => undefined);
      }
      return;
    }
    setDocumentPage(ref.page);
    setDocumentBlock(ref.blockIndex);
    setDocumentAnchor(ref.blockIndex);
    void api.saveProgress(contentId, { contentType: 'document', page: ref.page, scrollRatio: 0 }).catch(() => undefined);
  };

  const createNote = useCallback(async (autoSave = false): Promise<void> => {
    const value = noteText.trim();
    if (!value || !content || !notesLoaded || notePending.current) return;
    notePending.current = true;
    setNoteBusy(true); setError(''); setNoteSaveStatus('saving');
    const ref: NoteItem['ref'] = draftRef.current ?? (content.contentType === 'video' ? { type: 'video', timestampSec: Math.floor(videoRef.current?.currentTime ?? 0) } : { type: 'document', page: documentPage, ...(documentBlock===undefined?{}:{blockIndex:documentBlock}) });
    draftRef.current = ref;
    try {
      const saved = autoSavedNote
        ? await api.updateNote(autoSavedNote.noteId, { content: value, expectedVersion: autoSavedNote.version })
        : await api.createNote(contentId, { content: value, ref });
      setNotes((current) => autoSavedNote ? current.map((note) => note.noteId === autoSavedNote.noteId ? saved : note) : [...current, saved]);
      setAutoSavedNote(saved); lastAutoSavedText.current = value; setNoteSaveStatus('saved');
      if ('isOverwritten' in saved && saved.isOverwritten) setError('该笔记在其他设备被修改过，已同步最新内容。');
      if (!autoSave) { setNoteText(''); setAutoSavedNote(null); lastAutoSavedText.current = ''; draftRef.current = null; setNoteSaveStatus('idle'); }
    } catch (reason) {
      setNoteSaveStatus('failed'); setError(reason instanceof Error ? reason.message : '笔记保存失败');
    } finally { notePending.current = false; setNoteBusy(false); }
  }, [autoSavedNote, content, contentId, documentPage, documentBlock, noteText, notesLoaded]);

  const savePlaybackNote = async (value: string, timestampSec: number): Promise<void> => {
    const saved = await api.createNote(contentId, { content: value, ref: { type: 'video', timestampSec } });
    setNotes((current) => [...current, saved]);
  };

  useEffect(() => {
    const value = noteText.trim();
    if (!value || value === lastAutoSavedText.current || editingNote || noteBusy || noteSaveStatus === 'failed') return;
    const timer = window.setTimeout(() => { void createNote(true); }, 1_000);
    return () => window.clearTimeout(timer);
  }, [createNote, noteText, documentPage, editingNote, noteBusy, noteSaveStatus]);

  const updateNote = async (): Promise<void> => {
    if (!editingNote || !noteText.trim() || notePending.current) return;
    const previous = editingNote; const value = noteText.trim();
    notePending.current = true; setNoteBusy(true); setError('');
    try {
      const result = await api.updateNote(previous.noteId, { content: value, expectedVersion: previous.version });
      setNotes((current) => current.map((note) => note.noteId === result.noteId ? result : note));
      setEditingNote(null); setNoteText(''); setAutoSavedNote(null); lastAutoSavedText.current = ''; draftRef.current = null;
      if (result.isOverwritten) setError('该笔记在其他设备被修改过，已同步最新内容。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '笔记更新失败，输入已保留，可重试');
    } finally { notePending.current = false; setNoteBusy(false); }
  };

  const deleteNote = async (note: NoteItem): Promise<void> => {
    if (notePending.current) return;
    notePending.current = true; setNoteBusy(true); setError('');
    try {
      await api.deleteNote(note.noteId);
      setNotes((current) => current.filter((item) => item.noteId !== note.noteId));
      if (autoSavedNote?.noteId === note.noteId || editingNote?.noteId === note.noteId) {
        setAutoSavedNote(null); setEditingNote(null); setNoteText(''); lastAutoSavedText.current = ''; draftRef.current = null; setNoteSaveStatus('idle');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '笔记删除失败'); }
    finally { notePending.current = false; setNoteBusy(false); }
  };

  const ask = async (): Promise<void> => {
    if (!qaQuestion.trim()) return;
    setBusy(true); setError('');
    try { setQaAnswer(await api.qa(contentId, qaQuestion.trim())); } catch (reason) { setError(reason instanceof ApiClientError && reason.code === 'NO_UNDERSTANDING' ? '尚未生成可用上下文，问答入口暂时置灰。' : reason instanceof Error ? reason.message : '问答失败'); } finally { setBusy(false); }
  };

  const generateSummary = async (): Promise<void> => {
    setBusy(true);
    try { setSummary((await api.summary(contentId)).summary); } catch (reason) { setError(reason instanceof Error ? reason.message : '摘要生成失败'); } finally { setBusy(false); }
  };

  const regenerateGeneratedNote = async (): Promise<void> => {
    setIsRegeneratingNote(true);
    setError('');
    try {
      const result = await api.regenerateGeneratedNote(contentId);
      setGeneratedNote(result.note); setReads((value) => ({ ...value, generatedNote: 'ready' }));
      setNotice(result.note ? '已按当前解析结果重新整理笔记。' : '当前没有可用于整理的知识点。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新整理笔记失败');
    } finally {
      setIsRegeneratingNote(false);
    }
  };

  const copyGeneratedNote = async (): Promise<void> => {
    if (!generatedNote) return;
    try {
      await navigator.clipboard.writeText(generatedNote.markdown);
      setNotice('已复制 AI 整理笔记。');
    } catch {
      setError('当前浏览器不允许复制，请手动选择笔记内容。');
    }
  };

  const downloadGeneratedNote = (): void => {
    if (!generatedNote || !content) return;
    const blob = new Blob([generatedNote.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${content.title}-AI整理笔记.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const parsedReady = reads.understanding === 'ready';
  const parsedMessage = reads.understanding === 'failed' ? '解析依据读取失败，请重试后查看。' : '正在读取解析依据…';
  const ready = content?.status === '已就绪';
  const visibleTextBlocks = (understanding?.textBlocks ?? []).filter((block) => block.source !== 'pdf' || isUsefulDocumentText(block.text));
  const isVideoEvidence = content?.contentType === 'video';
  const textBlocksTitle = isVideoEvidence ? '画面文字 / OCR' : '文本块 / OCR';
  const emptyTextBlocksMessage = resource?.pasteSource ? '本资料正文在分段阅读区展示，不经过OCR；这里0块不代表导入失败。' : resource?.format.toUpperCase() === 'PDF'
    ? '当前 PDF 未提取到可靠文字，已隐藏无意义符号；你仍可逐页阅读并实时记笔记。'
    : isVideoEvidence
      ? reads.status !== 'ready'
        ? '暂无已保存的画面文字，处理状态尚未确认；可在解析状态处重新读取。'
        : phase === 'failed'
          ? '本次理解任务失败，暂无已保存的画面文字。请查看解析状态中的失败提示；已有语音转写仍可阅读。'
          : phase === 'none'
            ? '视频尚未启动理解，暂无画面文字；文件可以播放不代表已完成 OCR。'
            : phase !== 'completed'
              ? '视频仍在理解处理中，画面文字尚未就绪；处理结束后会更新解析依据。'
              : `理解任务已结束，但没有保存画面 OCR 文字。${understanding?.transcriptSegments.length ? `已有 ${understanding.transcriptSegments.length} 段语音转写，可在语音转写区域阅读。` : ''}仅凭 0 块无法判断是画面未检出文字还是视觉推理未完成，需核对本次处理日志。`
      : ['PNG', 'JPEG', 'JPG'].includes(resource?.format.toUpperCase() ?? '')
        ? '暂无可显示的识别文字；图片可以查看不代表 OCR 已成功，需核对本次图像识别结果。'
        : '当前文档暂无可显示的正文，请核对文件内容和解析结果；你仍可查看原资料并记笔记。';
  const openStudyTool = (tool: 'watched' | 'manual' | 'parsed'): void => {
    if (tool === 'manual') setActiveNotePanel('manual');
    if (tool === 'parsed') {
      if (content?.contentType === 'video' && parsedNotesRef.current) parsedNotesRef.current.open = true;
      else setActiveNotePanel('ai');
    }
    window.requestAnimationFrame((): void => {
      document.getElementById(tool === 'watched' ? 'study-watched-notes' : tool === 'parsed' && content?.contentType === 'video' ? 'study-parsed-notes' : 'study-complete-notes')?.scrollIntoView({ block: 'start' });
    });
  };
  const pasteSourceInfo = resource?.pasteSource ? <section className="mb-5 min-w-0 rounded-xl border border-glass-line bg-surface p-4 text-sm leading-6"><h2 className="font-semibold">粘贴正文 · 本人提供</h2><p className="mt-2 whitespace-pre-wrap break-words">来源说明：{resource.pasteSource.label}</p><p className="mt-2 text-textSub">作者：{resource.pasteSource.author??'未提供'}（本人填写）；保存时间：{new Date(resource.pasteSource.importedAt).toLocaleString()}。来源未经原站核验，未自动访问文内链接。</p><p className="mt-2 text-textSub">正文快照已保存；请在下方提取选段，再打开“章节笔记与摘录”，或按选段创建专题提问。阅读就绪不表示全文AI已整理。</p></section> : null;
  const sourceInfo = resource?.source ? <section className="mb-5 min-w-0 rounded-xl border border-glass-line bg-surface p-4 text-sm leading-6 text-textSub"><h2 className="font-semibold text-text">链接来源快照</h2><p>{resource.source.title}</p><p className="break-all">原链接：<a className="text-brand-ink underline" href={resource.source.requestedUrl} target="_blank" rel="noreferrer noopener">{resource.source.requestedUrl}</a></p>{resource.source.finalUrl!==resource.source.requestedUrl?<p className="break-all">最终链接：{resource.source.finalUrl}</p>:null}<p>作者：{resource.source.author??'来源未提供'} · 发布时间：{resource.source.publishedLabel??'来源未提供'}</p><p>获取于 {new Date(resource.source.fetchedAt).toLocaleString()}；固定版本，不随原网页更新。{isVideoEvidence ? '视频已保存到我的资料，可播放并按时间定位笔记；解析与AI整理进度单独显示。' : '此快照支持阅读与个人笔记，也可选段生成原文要点；不代表整份资料已AI整理。'}</p>{resource.source.previousContentId?<p>本资料另存自同一来源，旧版本和旧笔记保持原位置。</p>:null}</section> : null;
  const reader = !content ? null : resource?.contentType === 'video' ? <video ref={videoRef} controls className="aspect-video w-full bg-black" src={resource.url} onLoadedMetadata={(event) => { const position = citationTime ?? (progress?.contentType === 'video' ? progress.positionSec : 0); if (Number.isFinite(position)) event.currentTarget.currentTime = position; setVideoPosition(event.currentTarget.currentTime); }} onPlay={() => setVideoPlaying(true)} onEnded={() => setVideoPlaying(false)} onSeeking={(event) => { setVideoSeekVersion((version) => version + 1); setVideoPosition(event.currentTarget.currentTime); }} onSeeked={(event) => setVideoPosition(event.currentTarget.currentTime)} onTimeUpdate={(event) => { const position = event.currentTarget.currentTime; setVideoPosition(position); if (!event.currentTarget.paused) void saveVideoProgress(position); }} onPause={(event) => { setVideoPlaying(false); setVideoPosition(event.currentTarget.currentTime); videoPlaying && reads.progress === 'ready' && void api.saveProgress(contentId, { contentType: 'video', positionSec: event.currentTarget.currentTime }).catch(() => undefined); }} /> : resource?.format.toUpperCase() === 'PDF' ? <div className="bg-[#edf0f3] p-4"><div className="mb-3 flex items-center justify-between gap-3 rounded border border-glass-line bg-surface px-3 py-2 text-xs text-textSub"><span>PDF 阅读 · 第 {documentPage} / {resource.pageCount ?? content.pageCount ?? '?'} 页</span><div className="flex gap-2"><button type="button" disabled={documentPage <= 1} onClick={() => { const page = documentPage - 1; setDocumentPage(page); void api.saveProgress(contentId, { contentType: 'document', page, scrollRatio: 0 }).catch(() => setError('阅读位置保存失败，请稍后重试')); }} className="rounded border border-glass-line px-2 py-1 disabled:opacity-40">上一页</button><button type="button" disabled={resource.pageCount !== null && documentPage >= resource.pageCount} onClick={() => { const page = documentPage + 1; setDocumentPage(page); void api.saveProgress(contentId, { contentType: 'document', page, scrollRatio: 0 }).catch(() => setError('阅读位置保存失败，请稍后重试')); }} className="rounded border border-glass-line px-2 py-1 disabled:opacity-40">下一页</button></div></div>{failedPdfPage === documentPage ? <div role="alert" className="rounded-lg bg-rose-soft p-4 text-sm text-rose">PDF 页面加载失败，请重试或打开原文件。<button type="button" className="ml-3 underline" onClick={() => setFailedPdfPage(null)}>重试本页</button><a href={resource.url} target="_blank" rel="noreferrer" className="ml-3 underline">打开原文件</a></div> : <Image unoptimized loading="eager" decoding="async" width={1200} height={1600} style={{ width: 'auto', height: 'auto' }} key={documentPage} src={`${resource.url}&page=${documentPage}`} alt={`${content.title} 第 ${documentPage} 页`} onError={() => setFailedPdfPage(documentPage)} className="mx-auto max-h-[760px] w-auto max-w-full bg-white shadow-sm" />}</div> : resource?.format.toUpperCase() === 'PNG' || resource?.format.toUpperCase() === 'JPG' || resource?.format.toUpperCase() === 'JPEG' ? <Image unoptimized loading="eager" decoding="async" width={1200} height={1600} style={{ width: 'auto', height: 'auto' }} src={resource.url} alt={content.title} className="mx-auto max-h-[620px] w-auto max-w-full object-contain" /> : resource?.format.toUpperCase() === 'EPUB' ? <p className="p-5 text-sm leading-7 text-textSub">EPUB为纯文本章节阅读，请读取下方书籍目录并提取选段。暂不展示图片、公式或原书排版。</p> : resource ? <iframe title="文档阅读器" src={resource.url} className="h-[620px] w-full bg-white" /> : <div className="flex h-72 items-center justify-center text-textSub">{loadFailed ? "资源暂不可用，请重试加载。" : "资源地址加载中…"}</div>;
  return <AppShell compactNavigation title={content?.title ?? (isStudyLanding ? '学习空间' : '学习内容')} subtitle={content ? `${content.contentType === 'video' ? '视频' : '图文'} · ${content.status}` : isStudyLanding ? '从一份内容开始，建立你的学习节奏。' : '正在载入内容…'}>
    <header className="mb-6 min-w-0">
      <Link href="/import" className="mb-3 inline-block min-h-11 content-center text-brand-ink">← 返回学习中心</Link>
      <h1 className="break-words text-2xl font-semibold text-text">{content?.title ?? (isStudyLanding ? '学习空间' : '学习内容')}</h1>
      <p className="mt-2 text-sm text-textSub">{content ? `${content.contentType === 'video' ? '视频' : '图文'} · ${content.status}` : isStudyLanding ? '从一份内容开始，建立你的学习节奏。' : '正在载入内容…'}</p>
      {ready && <nav aria-label="学习页笔记工具" className="study-tools"><div className="study-tool-buttons">{content.contentType === 'video' && <button type="button" onClick={(): void => openStudyTool('watched')}>随看笔记</button>}<button type="button" aria-label="打开我的笔记" onClick={(): void => openStudyTool('manual')}>我的笔记</button><button type="button" aria-label="打开预解析重点" onClick={(): void => openStudyTool('parsed')}>预解析重点</button></div><p>{content.contentType === 'video' ? '随看笔记按已看内容调用 AI；预解析重点是已有结果；个人补充独立保存。' : '先阅读原资料，再查看预解析重点或记录自己的笔记。'}</p></nav>}
    </header>
    {pasteSourceInfo}{sourceInfo}
    {error ? <div role="alert" className="mb-5 rounded-md bg-rose-soft px-4 py-3 text-sm text-rose">{error}{loadFailed ? <button type="button" className="ml-3 underline" onClick={() => void load()}>重新加载资料</button> : null}</div> : null}
    {notice ? <p className="mb-5 rounded-md bg-teal-soft px-4 py-3 text-sm text-teal">{notice}</p> : null}
    {ready && (Object.keys(readLabels) as ReadPart[]).map((part) => reads[part] === 'ready' ? null : <div key={part} role={reads[part] === 'failed' ? 'alert' : 'status'} className="mb-3 rounded-lg bg-bg px-4 py-2 text-sm text-textSub">{readLabels[part]}{reads[part] === 'failed' ? '读取失败' : '读取中…'}{part === 'progress' && '，读取成功前暂停自动保存位置。'}{reads[part] === 'failed' && <button type="button" className="ml-3 min-h-11 text-brand-ink" onClick={() => void readPart(part)}>重试{readLabels[part]}</button>}</div>)}
    {reads.status === 'ready' && phase === 'failed' ? <p role="alert" className="mb-5 rounded-lg bg-rose-soft px-4 py-3 text-sm leading-6 text-rose">{understandingFailureReason || 'AI 整理未完成。'} 原资料仍可播放和手动记笔记，可展开处理详情查看。</p> : null}
    {understanding?.degradation && !resource?.pasteSource ? <p className="mb-5 rounded-lg bg-amber-soft px-4 py-3 text-sm leading-6 text-textSub">{resource?.source ? '链接快照阅读已就绪；可提取选段并记个人笔记，可在“章节笔记与摘录”生成选段原文要点；整书AI状态独立。' : resource?.format.toUpperCase() === 'EPUB' ? 'EPUB章节阅读已就绪；可提取选段并记个人笔记，可在“章节笔记与摘录”生成选段原文要点；不代表整书已整理。' : understanding.degradation}</p> : null}
    {showStudyLanding ? <section className="flex min-h-96 items-center justify-center rounded-lg border border-dashed border-glass-line bg-surface p-8 text-center"><div className="max-w-md"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-2xl text-brand-ink">✦</div><h2 className="mt-5 text-xl font-semibold">还没有可学习的内容</h2><p className="mt-3 text-sm leading-6 text-textSub">{availableContents.length > 0 ? '内容还在解析中，完成后会自动出现在这里。' : '先导入一段视频、一份文档或一张笔记，文豪就能帮你整理重点。'}</p><div className="mt-6 flex justify-center gap-3"><Link href="/import" className="rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">导入第一份内容</Link><Link href="/dashboard" className="rounded-md border border-glass-line px-5 py-3 text-sm text-textSub">返回工作台</Link></div></div></section> : !content ? <div className="flex min-h-64 items-center justify-center text-textSub">正在载入内容…</div> : !ready ? <section className="rounded-lg border border-amber/30 bg-amber-soft p-8 text-center"><h2 className="text-lg font-semibold">内容正在准备中</h2><p className="mt-2 text-sm text-textSub">当前状态：{content.status}。浏览、笔记和问答入口会在解析完成后开放。</p></section> : <div className="grid min-w-0 grid-cols-1 items-start gap-6 break-words xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <div className="overflow-hidden rounded-lg border border-glass-line bg-surface">
{resource && resource.contentType === 'document' && ['PDF','TXT','MD','EPUB'].includes(resource.format.toUpperCase()) ? <BookReader key={contentId} contentId={contentId} page={documentPage} sourceUrl={resource.url} initialBlock={resource.format.toUpperCase() === 'PDF' ? undefined : citationBlock ?? documentAnchor} onPage={(page): void => { setDocumentPage(page); void api.saveProgress(contentId, { contentType: 'document', page, scrollRatio: 0 }).catch(() => setError('阅读位置保存失败，请重试')); }} onBlock={setDocumentBlock}>{reader}</BookReader> : reader}
        </div>
        {resource?.contentType === 'video' ? <div id="study-watched-notes" className="study-tool-target min-w-0 space-y-4"><WatchedNotes key={`${contentId}-watched`} contentId={contentId} positionSec={videoPosition} playing={videoPlaying} seekVersion={videoSeekVersion} understanding={understanding} onJump={(timestampSec) => jumpToRef({ type: 'video', timestampSec })} onSave={savePlaybackNote} /><details id="study-parsed-notes" ref={parsedNotesRef} className="study-tool-target"><summary className="min-h-11 cursor-pointer text-sm text-textSub">预解析重点与个人补充</summary><PlaybackNotes key={contentId} positionSec={videoPosition} durationSec={content.durationSec} understanding={understanding} readStatus={reads.understanding} onJump={(timestampSec) => jumpToRef({ type: 'video', timestampSec })} onSave={savePlaybackNote} /></details></div> : null}
      <section id="study-complete-notes" aria-label="完整笔记" className="study-tool-target min-w-0 space-y-6">
        <section hidden={activeNotePanel !== 'ai'} className="rounded-xl border border-glass-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2 text-sm"><button type="button" onClick={() => setActiveNotePanel('ai')} className="rounded-lg bg-brand px-3 py-2 font-medium text-bg">AI 整理笔记</button><button type="button" onClick={() => setActiveNotePanel('manual')} className="rounded-lg border border-glass-line px-3 py-2 text-textSub hover:border-brand">我的笔记</button></div><p className="mt-3 text-xs leading-5 text-textSub">由当前解析的知识点自动组织；你的手动笔记始终独立保存。</p>{resource?.format.toUpperCase() === 'PDF' ? <p className="mt-2 text-xs leading-5 text-textSub">AI 笔记是选取来源生成的重点摘要，不代表逐页完整覆盖；请结合左侧原文核对章节。</p> : null}</div><span className="rounded-full bg-brand-soft px-3 py-1 text-xs text-brand-ink">{reads.generatedNote !== 'ready' ? (reads.generatedNote === 'failed' ? '读取失败' : '正在读取') : generatedNote ? `${generatedNote.sourceCount} 条解析依据` : '暂无 AI 笔记'}</span></div>
          {reads.generatedNote !== 'ready' ? <p role="status" className="mt-4 text-textSub">{reads.generatedNote === 'failed' ? 'AI 笔记读取失败，可使用上方独立重试。' : '正在读取 AI 笔记…'}</p> : generatedNote ? <><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void regenerateGeneratedNote()} disabled={isRegeneratingNote} className="rounded-lg border border-brand px-3 py-2 text-xs text-brand-ink disabled:opacity-50">{isRegeneratingNote ? '正在重新整理…' : '按当前解析重新整理'}</button><button type="button" onClick={() => void copyGeneratedNote()} className="rounded-lg border border-glass-line px-3 py-2 text-xs text-textSub hover:border-brand">复制 Markdown</button><button type="button" onClick={downloadGeneratedNote} className="rounded-lg border border-glass-line px-3 py-2 text-xs text-textSub hover:border-brand">导出 .md</button></div><pre className="mt-4 whitespace-pre-wrap rounded-xl bg-bg p-4 font-sans text-sm leading-7 text-textSub">{generatedNote.markdown}</pre><div className="mt-4 rounded-xl border border-dashed border-glass-line p-3"><p className="text-xs font-medium text-text">解析证据</p>{!parsedReady ? <p className="mt-2 text-sm text-textSub">{parsedMessage}</p> : understanding?.knowledgePoints.length ? <div className="mt-2 flex flex-wrap gap-2">{understanding.knowledgePoints.slice(0, 4).map((point) => point.refs[0] ? <button type="button" key={point.pointId} onClick={() => jumpToRef(point.refs[0])} className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand-ink">{point.title} · {refLabel(point.refs[0])}</button> : null)}</div> : <p className="mt-1 text-xs text-textMute">当前还没有可定位的解析证据。</p>}</div></> : <div className="mt-4 rounded-xl bg-amber-soft p-4"><p className="text-sm font-medium">暂无已保存的 AI 笔记</p><p className="mt-1 text-sm leading-6 text-textSub">当前没有已保存的自动笔记。可查看处理状态和解析依据，也可以先写自己的笔记。</p><button type="button" onClick={() => setActiveNotePanel('manual')} className="mt-3 rounded-lg border border-brand px-3 py-2 text-xs text-brand-ink">先记一条自己的笔记</button></div>}
        </section>
        <section hidden={activeNotePanel !== 'manual'} className="rounded-xl border border-glass-line bg-surface p-5">
          <div className="mb-4 flex gap-2 text-sm"><button type="button" onClick={() => setActiveNotePanel('ai')} className="rounded-lg border border-glass-line px-3 py-2 text-textSub hover:border-brand">AI 整理笔记</button><button type="button" onClick={() => setActiveNotePanel('manual')} className="rounded-lg bg-brand px-3 py-2 font-medium text-bg">我的笔记</button></div>
          <div className="flex items-center justify-between"><div><h2 className="font-semibold">实时笔记</h2><p className="mt-1 text-xs text-textSub">笔记绑定当前视频时间或原文位置；EPUB使用当前全书段号。</p></div>{content.contentType === 'document' && resource?.format.toUpperCase() !== 'EPUB' ? <label className="text-xs text-textSub">页码<input type="number" min={1} value={documentPage} onChange={(event) => setDocumentPage(Math.max(1, Number(event.target.value) || 1))} className="ml-2 w-16 rounded border border-glass-line bg-bg px-2 py-1 text-text" /></label> : null}</div>
          <textarea value={noteText} disabled={noteBusy || !notesLoaded || (resource?.format.toUpperCase() === 'EPUB' && documentBlock === undefined)} maxLength={5000} onChange={(event) => { if (!noteText && !editingNote && !autoSavedNote) draftRef.current = content.contentType === 'video' ? { type: 'video', timestampSec: Math.floor(videoRef.current?.currentTime ?? 0) } : { type: 'document', page: documentPage, ...(documentBlock===undefined?{}:{blockIndex:documentBlock}) }; setNoteText(event.target.value); setNoteSaveStatus('idle'); }} className="mt-4 min-h-24 w-full rounded-md border border-glass-line bg-bg p-3 text-sm text-text outline-none focus:border-brand" placeholder={editingNote ? '修改笔记内容…' : '记录此刻的理解，停止输入 1 秒后自动保存…'} />
          <div className="mt-3 flex items-center justify-between gap-2"><span className={`text-xs ${noteSaveStatus === 'failed' ? 'text-rose' : 'text-textMute'}`}>{noteSaveStatus === 'saving' ? '正在自动保存…' : noteSaveStatus === 'saved' ? (content.contentType === 'video' ? '已自动保存到视频时间点' : resource?.format.toUpperCase() === 'EPUB' ? '已自动保存到原文段落' : '已自动保存到当前页') : noteSaveStatus === 'failed' ? '自动保存失败，请立即重试' : (content.contentType === 'video' ? '笔记会自动绑定视频时间点' : resource?.format.toUpperCase() === 'EPUB' ? `笔记绑定全书第 ${(documentBlock ?? 0) + 1} 段` : '笔记会自动绑定当前页码')}</span><div className="flex gap-2">{editingNote ? <button type="button" disabled={noteBusy || !notesLoaded} onClick={() => { setEditingNote(null); setNoteText(''); setAutoSavedNote(null); lastAutoSavedText.current = ''; draftRef.current = null; setNoteSaveStatus('idle'); }} className="rounded-md border border-glass-line px-4 py-2 text-sm text-textSub">取消</button> : <button type="button" disabled={noteBusy || !notesLoaded} onClick={() => { setAutoSavedNote(null); setNoteText(''); lastAutoSavedText.current = ''; draftRef.current = null; setNoteSaveStatus('idle'); }} className="rounded-md border border-glass-line px-4 py-2 text-sm text-textSub">新建一条</button>}<button type="button" disabled={noteBusy || !notesLoaded || !noteText.trim()} onClick={() => void (editingNote ? updateNote() : createNote())} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{editingNote ? '保存修改' : '立即保存'}</button></div></div>
          {!notesLoaded && <p role="status" className="mt-4 text-sm text-textSub">{loadFailed ? '个人笔记暂不可用，请重新加载资料。' : '正在读取个人笔记…'}</p>}
          {notesLoaded && notes.length === 0 && <p className="mt-4 text-sm text-textSub">还没有个人笔记。</p>}
          <div className="mt-5 space-y-3">{notesLoaded && notes.map((note) => <article key={note.noteId} className="rounded-md border border-glass-line p-3"><div className="flex items-start justify-between gap-3"><p className="whitespace-pre-wrap text-sm leading-6">{note.content}</p><button type="button" onClick={() => jumpToRef(note.ref)} className="shrink-0 text-xs text-brand-ink hover:underline">{refLabel(note.ref,resource?.format)}</button></div><div className="mt-3 flex gap-3 text-xs text-textMute"><button type="button" disabled={noteBusy || !notesLoaded} onClick={() => { setEditingNote(note); setAutoSavedNote(null); lastAutoSavedText.current = ''; draftRef.current = note.ref; setNoteText(note.content); setNoteSaveStatus('idle'); }} className="hover:text-brand-ink">编辑</button><button type="button" disabled={noteBusy || !notesLoaded} onClick={() => void deleteNote(note)} className="hover:text-rose">删除</button></div></article>)}</div>
        </section>
      </section>
      <aside className="min-w-0 space-y-6">
        <details className="rounded-lg border border-glass-line bg-surface p-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-brand-ink">查看处理详情</summary><div className="mt-4"><div className="flex items-start justify-between"><div><h2 className="font-semibold">解析进度</h2><p className="mt-1 text-xs text-textSub">阶段 A / B 会随着后台任务更新。</p></div><span className={`text-xs ${phase === 'failed' ? 'text-rose' : 'text-teal'}`}>{reads.status === 'ready' ? phaseLabels[phase] ?? 'AI 整理进行中' : reads.status === 'failed' ? '状态读取失败' : '状态读取中…'}</span></div><div className="mt-5 space-y-3 text-sm">{parsedReady && understanding?.knowledgePoints.slice(0, 5).map((point) => <div key={point.pointId} className="rounded border border-glass-line p-3"><div className="flex items-start justify-between gap-2"><strong>{point.title}</strong><button type="button" onClick={() => jumpToRef(point.refs[0] ?? { type: 'document', page: 1 })} className="text-xs text-brand-ink">定位</button></div><p className="mt-1 text-xs leading-5 text-textSub">{point.summary}</p></div>)}</div></div></details>
        <details className="rounded-lg border border-glass-line bg-surface p-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">语音转写段落 <span className="ml-2 text-xs font-normal text-textMute">{parsedReady ? `${understanding?.transcriptSegments.length ?? 0} 段` : '—'}</span></summary>{!parsedReady ? <p className="mt-3 text-sm text-textSub">{parsedMessage}</p> : understanding?.transcriptSegments.length ? <div className="mt-4 max-h-64 space-y-2 overflow-auto">{understanding.transcriptSegments.map((segment) => <button key={segment.segmentId} type="button" onClick={() => jumpToRef({ type: 'video', timestampSec: Math.floor(segment.startMs / 1000) })} className="block w-full rounded border border-glass-line p-3 text-left transition hover:border-brand"><span className="text-xs text-brand-ink">{formatTimestamp(segment.startMs)}</span><p className="mt-1 text-sm leading-5 text-textSub">{segment.text}</p></button>)}</div> : <p className="mt-3 text-sm text-textMute">暂无可用转写，可能是 ASR 未配置或内容尚未完成理解。</p>}</details>
        <details className="rounded-lg border border-glass-line bg-surface p-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">{textBlocksTitle} <span className="ml-2 text-xs font-normal text-textMute">{parsedReady ? `${visibleTextBlocks.length} 块` : '—'}</span></summary><p className="mt-3 text-xs leading-5 text-textSub">{isVideoEvidence ? '此处只显示板书、课件等画面中识别到的文字；老师的讲话在“语音转写”中。' : '此处显示文档正文或图片识别文字，数量不代表笔记条数。'}</p>{!parsedReady ? <p className="mt-3 text-sm text-textSub">{parsedMessage}</p> : visibleTextBlocks.length ? <div className="mt-4 max-h-64 space-y-2 overflow-auto">{visibleTextBlocks.map((block) => <button key={block.blockId} type="button" onClick={() => jumpToRef(block.ref)} className="block w-full rounded border border-glass-line p-3 text-left transition hover:border-brand"><span className="text-xs text-teal">{block.source} · {refLabel(block.ref)}</span><p className="mt-1 text-sm leading-5 text-textSub">{block.text}</p></button>)}</div> : <p className="mt-3 text-sm text-textMute">{emptyTextBlocksMessage}</p>}</details>
        <section className="rounded-lg border border-glass-line bg-surface p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">学习摘要</h2><button type="button" disabled={reads.status !== 'ready' || phase !== 'completed' || busy} onClick={() => void generateSummary()} className="text-xs text-brand-ink disabled:text-textMute">生成摘要</button></div>{summary ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-textSub">{summary}</p> : <p className="mt-3 text-sm text-textMute">{resource?.pasteSource||resource?.source ? '可在阅读区“章节笔记与摘录”生成选段原文要点，整书AI整理状态独立。' : resource?.format.toUpperCase() === 'EPUB' ? '可在阅读区“章节笔记与摘录”生成选段原文要点，不覆盖旧自动笔记。' : '解析完成后可生成摘要。'}</p>}</section>
        <section className="rounded-lg border border-glass-line bg-surface p-5"><h2 className="font-semibold">知识问答</h2><textarea value={qaQuestion} onChange={(event) => setQaQuestion(event.target.value)} disabled={reads.status !== 'ready' || phase !== 'completed'} className="mt-4 min-h-20 w-full rounded-md border border-glass-line bg-bg p-3 text-sm outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50" placeholder={phase === 'completed' ? '只基于本内容提问…' : '等待可用解析上下文'} /><button type="button" disabled={busy || reads.status !== 'ready' || phase !== 'completed' || !qaQuestion.trim()} onClick={() => void ask()} className="mt-3 w-full rounded-md border border-brand py-2 text-sm text-brand-ink disabled:opacity-50">提问</button>{qaAnswer ? <div className="mt-4 rounded-md bg-white/5 p-3"><p className="whitespace-pre-wrap text-sm leading-6">{qaAnswer.answer}</p>{qaAnswer.citations.length > 0 ? <div className="mt-3 border-t border-glass-line pt-3 text-xs text-textSub"><p className="mb-1">引用出处</p>{qaAnswer.citations.map((citation) => <button key={`${citation.excerpt}-${refLabel(citation.ref)}`} type="button" onClick={() => jumpToRef(citation.ref)} className="mb-1 block text-left hover:text-brand-ink">[{refLabel(citation.ref)}] {citation.excerpt}</button>)}</div> : null}</div> : null}</section>
      </aside>
    </div>}
    {ready && <StudyNextSteps contentId={contentId} />}
  </AppShell>;
}

export default function StudyPage(props: { searchParams?: StudySearchParams }): ReactElement;
export default function StudyPage(props: { searchParams?: Promise<StudySearchParams> }): ReactElement;
export default function StudyPage(props: { searchParams?: StudySearchParams | Promise<StudySearchParams> }): ReactElement {
  const params = useParams<{ id: string }>();
  const searchParams = isRoutePromise(props.searchParams) ? use(props.searchParams) : props.searchParams;
  return <StudyWorkspace key={params.id} searchParams={searchParams} />;
}
