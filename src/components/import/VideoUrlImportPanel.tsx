'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { videoImports } from '@/services/video-imports';
import type { UrlDraftView } from '@/lib/url-imports/contracts';

const storageKey = 'learning-video-url-id';
const control = 'min-h-11 rounded-xl border border-glass-line px-4 py-2 text-sm disabled:opacity-50';
const labels: Record<UrlDraftView['state'], string> = { FETCHING: '正在下载并校验视频，可重读状态或取消', PREVIEW: '链接状态待核对', FAILED: '视频导入失败', CANCELLED: '视频导入已取消', EXPIRED: '导入已过期', COMMITTED: '视频已保存，解析与笔记进度请查看我的资料' };

export function VideoUrlImportPanel({ onSaved }: { onSaved: () => void }): ReactElement {
  const [url, setUrl] = useState(''), [checked, setChecked] = useState(false), [draft, setDraft] = useState<UrlDraftView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef<string | null>(null), controller = useRef<AbortController | null>(null), sequence = useRef(0), mounted = useRef(true), saved = useRef<string | null>(null);
  const invalidate = (): void => { sequence.current++; };
  const apply = (value: UrlDraftView): void => {
    setDraft(value);
    if (value.state === 'COMMITTED' && saved.current !== value.contentId) { saved.current = value.contentId; onSaved(); }
  };
  useEffect(() => {
    mounted.current = true;
    const version = ++sequence.current, id = sessionStorage.getItem(storageKey);
    if (id) { current.current = id; void videoImports.read(id).then((value): void => { if (mounted.current && sequence.current === version) apply(value); }).catch((): void => { if (mounted.current && sequence.current === version) setError('上次导入状态暂不可用，请重新读取状态。'); }); }
    return (): void => { mounted.current = false; invalidate(); controller.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: () => Promise<UrlDraftView>): Promise<void> => {
    const version = ++sequence.current; setBusy(true); setError('');
    try { const value = await action(); if (mounted.current && sequence.current === version) apply(value); }
    catch { if (mounted.current && sequence.current === version) setError('导入结果暂未确认，请重新读取状态，避免重复下载。'); }
    finally { if (mounted.current && sequence.current === version) setBusy(false); }
  };
  const start = (): void => {
    if (busy || current.current || !checked || !url.trim()) return;
    const id = crypto.randomUUID(); current.current = id; sessionStorage.setItem(storageKey, id); controller.current = new AbortController();
    setDraft({ requestId: id, state: 'FETCHING', expiresAt: '', error: null, contentId: null, preview: null, existing: [] });
    void run(() => videoImports.import(id, url, controller.current!.signal));
  };
  const cancel = (): void => { if (!current.current) return; controller.current?.abort(); void run(() => videoImports.cancel(current.current!)); };
  const reset = (): void => { if (busy || draft?.state === 'FETCHING') return; current.current = null; sessionStorage.removeItem(storageKey); setDraft(null); setChecked(false); setError(''); };
  const active = draft?.state === 'FETCHING' || Boolean(current.current && !draft);
  return <section className="min-w-0 space-y-4 rounded-xl border border-glass-line bg-surface p-5 shadow-sm">
    <div><h3 className="font-semibold">视频直链导入</h3><p className="mt-2 text-sm leading-6 text-textSub">粘贴公开 MP4/WebM 文件链接，下载后进入课堂视频解析与笔记流程。B站、网盘等播放页面暂不支持。</p></div>
    <label className="block text-sm">视频文件直链<input type="url" aria-label="视频文件直链" placeholder="https://…/lesson.mp4" value={url} disabled={Boolean(current.current)} onChange={(event): void => { setUrl(event.target.value); setChecked(false); }} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-glass-line bg-bg px-3"/></label>
    <p className="text-xs leading-5 text-textMute">最大100 MB，下载限时120秒，视频最长2小时。支持H.264 MP4及VP8/VP9/AV1 WebM；不支持登录资源、网盘、HLS或DRM。</p>
    {!current.current ? <label className="flex min-h-11 items-start gap-2 text-sm leading-6"><input type="checkbox" checked={checked} onChange={(event): void => setChecked(event.target.checked)} className="mt-1"/>我有权导入此视频，并同意下载后调用已配置的OCR、语音转写和AI整理服务，可能消耗服务额度。</label> : null}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || Boolean(current.current) || !checked || !url.trim()} onClick={start} className={control + ' bg-brand text-white'}>{busy ? '正在处理…' : '导入视频并开始解析'}</button>{current.current ? <button type="button" onClick={(): void => { void run(() => videoImports.read(current.current!)); }} className={control}>重新读取状态</button> : null}{active ? <button type="button" onClick={cancel} className={control}>取消导入</button> : null}</div>
    {error ? <p role="alert" className="text-sm text-rose">{error}</p> : null}
    {draft ? <div role="status" className="text-sm leading-6 text-textSub">{labels[draft.state]}{draft.error ? <p className="mt-2 text-rose">{draft.error}</p> : null}</div> : null}
    {draft?.state === 'COMMITTED' && draft.contentId ? <Link href={'/study/' + encodeURIComponent(draft.contentId)} className={control + ' inline-flex items-center bg-brand-soft text-brand-ink'}>进入学习</Link> : null}
    {!busy && current.current && draft?.state !== 'FETCHING' ? <button type="button" onClick={reset} className={control}>清除本机编号，开始新的导入</button> : null}
  </section>;
}
