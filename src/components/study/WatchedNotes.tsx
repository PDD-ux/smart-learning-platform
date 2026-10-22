'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { watchedSources, type WatchedSource, type WatchedNote } from '@/lib/domain/watched-notes';
import { playbackTimeLabel } from '@/lib/domain/playback-notes';
import { generateWatchedNote } from '@/services/watched-notes';
import type { Understanding } from '@/services/api';
import { WatchedNoteBody } from '@/components/study/WatchedNoteBody';

type Props = { contentId: string; positionSec: number; playing: boolean; seekVersion: number; understanding: Understanding | null; onJump: (seconds: number) => void; onSave: (text: string, seconds: number) => Promise<void> };
type Entry = WatchedNote & { key: string; saved: boolean };

export function WatchedNotes({ contentId, positionSec, playing, seekVersion, understanding, onJump, onSave }: Props): ReactElement {
  const [enabled, setEnabled] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const failure = useRef(false);
  const saveLock = useRef(false);
  const completed = useRef(new Set<string>());
  const eligible = useRef(new Map<string, WatchedSource>());
  const previous = useRef({ position: positionSec, playing: false, seek: seekVersion, enabled });
  const start = useRef(positionSec);
  const lastRequest = useRef(positionSec);
  const requests = useRef(0);
  const flushTail = useRef(false);
  const retry = useRef<{ ids: string[]; throughSec: number } | null>(null);

  useEffect((): (() => void) => { alive.current = true; return (): void => { alive.current = false; }; }, []);
  useEffect((): (() => void) => {
    const warn = (event: BeforeUnloadEvent): void => { if (entries.some((entry): boolean => !entry.saved) || lock.current) { event.preventDefault(); event.returnValue = ''; } };
    const warnLink = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (target && (entries.some((entry): boolean => !entry.saved) || lock.current) && !window.confirm('本次随看笔记仍有未保存内容，离开会丢失。确定离开吗？')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', warnLink, true);
    return (): void => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', warnLink, true); };
  }, [entries]);

  const generate = useCallback(async (manual = false): Promise<void> => {
    if (lock.current || (!manual && failure.current)) return;
    if (requests.current >= 60) { failure.current = true; setError('本页已达到60批整理上限，请保存或导出已有笔记。'); return; }
    let request = manual ? retry.current : null;
    if (!request) {
      let characters = 0;
      const sources: WatchedSource[] = [];
      for (const source of [...eligible.current.values()].sort((a, b): number => a.startMs - b.startMs)) {
        if (completed.current.has(source.segmentId)) continue;
        if (sources.length === 12 || characters + source.text.length > 6000) break;
        sources.push(source); characters += source.text.length;
      }
      if (!sources.length) return;
      request = { ids: sources.map((source): string => source.segmentId), throughSec: Math.max(...sources.map((source): number => source.endMs / 1000)) };
    }
    lock.current = true; requests.current += 1; retry.current = request;
    setBusy(true); setError('');
    try {
      const note = await generateWatchedNote(contentId, request.ids, request.throughSec);
      if (!alive.current) return;
      for (const id of request.ids) completed.current.add(id);
      setEntries((old): Entry[] => [...old, { ...note, key: request.ids.join(':'), saved: false }]);
      setPendingCount([...eligible.current.keys()].filter((id): boolean => !completed.current.has(id)).length);
      retry.current = null; failure.current = false;
    } catch (reason) { if (alive.current) { failure.current = true; setError(reason instanceof Error ? reason.message : '随看笔记生成失败，请手动重试。'); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }, [contentId]);

  useEffect((): void => {
    const old = previous.current;
    const jumped = seekVersion !== old.seek || positionSec < old.position || positionSec - old.position > 5;
    if (jumped || !enabled || !old.enabled || (!old.playing && playing)) {
      start.current = positionSec; lastRequest.current = positionSec;
    }
    if (!jumped && enabled && (old.playing || playing)) {
      const seen = new Set([...eligible.current.keys(), ...completed.current]);
      for (const source of watchedSources(understanding?.transcriptSegments ?? [], start.current, positionSec, seen)) eligible.current.set(source.segmentId, source);
      setPendingCount([...eligible.current.keys()].filter((id): boolean => !completed.current.has(id)).length);
      if (positionSec - lastRequest.current >= 30 || (old.playing && !playing)) {
        if (old.playing && !playing) flushTail.current = true;
        if (!lock.current && !failure.current) { lastRequest.current = positionSec; void generate(); }
      }
    }
    previous.current = { position: positionSec, playing, seek: seekVersion, enabled };
    if (!playing && enabled && flushTail.current && !lock.current && !failure.current) {
      if ([...eligible.current.keys()].some((id): boolean => !completed.current.has(id))) void generate();
      else flushTail.current = false;
    }
  }, [positionSec, playing, seekVersion, understanding, enabled, generate, busy, pendingCount]);

  const save = async (entry: Entry): Promise<void> => {
    if (saveLock.current || entry.saved) return;
    saveLock.current = true; setSaving(entry.key); setSaveError('');
    try {
      const text = `${entry.mode === 'source-extract' ? '随看AI笔记（原文摘录，转写待核对）' : '随看AI笔记（辅助，待核对）'}\n\n${entry.markdown}`;
      if (text.length > 5000) throw new Error('本段超过个人笔记上限，请导出后分段保存。');
      await onSave(text, Math.floor(entry.sources[0].startMs / 1000));
      if (alive.current) setEntries((old): Entry[] => old.map((item): Entry => item.key === entry.key ? { ...item, saved: true } : item));
    } catch (reason) { if (alive.current) setSaveError(reason instanceof Error ? reason.message : '保存失败，笔记已保留。'); }
    finally { saveLock.current = false; if (alive.current) setSaving(null); }
  };
  const download = (): void => {
    const markdown = '# 本次随看课堂笔记\n\n> 仅包含本次已完整观看并成功整理的来源；AI辅助内容请核对，未覆盖整课。\n\n' + entries.map((entry): string => `${entry.markdown}\n\n${entry.sources.map((source): string => `> ${playbackTimeLabel(source.startMs / 1000)} ${source.text}`).join('\n\n')}`).join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '随看课堂笔记.md'; anchor.click(); window.setTimeout((): void => URL.revokeObjectURL(url), 1000);
  };

  return <section aria-label="随看AI笔记" className="min-w-0 rounded-xl border border-brand/30 bg-surface p-5">
    <h2 className="font-semibold">边看边生成笔记</h2>
    <p className="mt-2 text-xs leading-5 text-textSub">约每30秒由AI挑选已看原文要点，保留真实摘录；无需麦克风，不提前整理跳过内容。</p>
    <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event): void => setEnabled(event.target.checked)} />随播放AI整理（会使用API额度）</label>
    <p role="status" className="text-xs text-textSub">播放 {playbackTimeLabel(positionSec)} · 已生成 {entries.length} 段{busy ? ' · 正在整理…' : pendingCount ? ` · ${pendingCount}条已看来源待整理` : ' · 等待完整转写片段'}</p>
    {error ? <div role="alert" className="mt-3 text-sm text-rose">{error} 自动请求已停止，已生成笔记保留。<button type="button" disabled={busy || requests.current >= 60} onClick={(): void => { void generate(true); }} className="ml-2 min-h-11 underline disabled:opacity-50">手动重试</button></div> : null}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !pendingCount || Boolean(error)} onClick={(): void => { void generate(true); }} className="min-h-11 rounded-lg border border-brand px-3 text-sm text-brand-ink disabled:opacity-50">整理剩余已看片段</button><button type="button" disabled={!entries.length} onClick={download} className="min-h-11 rounded-lg border border-glass-line px-3 text-sm disabled:opacity-50">导出本次笔记</button></div>
    <p className="mt-2 text-xs leading-5 text-textMute">原文摘录可能有转写错误或缺少跨批上下文；历史AI摘要仍待核对。本次笔记暂存在本页，离开前请保存或导出；下方完整笔记仍是预解析结果。</p>
    {saveError ? <p role="alert" className="mt-2 text-sm text-rose">{saveError}</p> : null}
    <div className="mt-4 max-h-[60vh] space-y-4 overflow-auto">
      {entries.map((entry, index): ReactElement => <article key={entry.key} className="rounded-lg border border-glass-line bg-bg p-3"><div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-glass-line pb-3 text-xs"><span className="font-medium text-brand-ink">第 {index + 1} 批 · {playbackTimeLabel(Math.min(...entry.sources.map((source): number => source.startMs)) / 1000)}—{playbackTimeLabel(Math.max(...entry.sources.map((source): number => source.endMs)) / 1000)}</span><span className={entry.saved ? "text-teal" : "text-textMute"}>{entry.saved ? "已保存" : "未保存"}</span></div><p className="mb-3 text-xs leading-5 text-textMute">{entry.mode === 'source-extract' ? 'AI精选原文 · ASR转写待核对' : '历史AI摘要 · 未按原文摘录规则核验'}</p><WatchedNoteBody markdown={entry.markdown} /><details className="mt-2"><summary className="min-h-11 cursor-pointer text-xs text-textSub">核对原文与时间</summary>{entry.sources.map((source): ReactElement => <div key={source.segmentId} className="mt-2"><button type="button" onClick={(): void => onJump(source.startMs / 1000)} className="min-h-11 text-xs text-brand-ink">回看 {playbackTimeLabel(source.startMs / 1000)}</button><p className="break-words text-xs leading-5 text-textSub">{source.text}</p></div>)}</details><button type="button" disabled={entry.saved || saving !== null} onClick={(): void => { void save(entry); }} className="mt-2 min-h-11 rounded-lg border border-brand px-3 text-sm text-brand-ink disabled:opacity-50">{entry.saved ? '已保存到我的笔记' : saving === entry.key ? '正在保存…' : '保存到我的笔记'}</button></article>)}
      {!entries.length ? <p className="text-sm leading-6 text-textSub">开始播放后，笔记会按观看片段逐段出现。尚未完整看过的转写不会送去整理。</p> : null}
    </div>
  </section>;
}
