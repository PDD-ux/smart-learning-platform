'use client';

import { useMemo, useRef, useState, type ReactElement } from 'react';

import { currentPlaybackSection, playbackSections, playbackTimeLabel } from '@/lib/domain/playback-notes';
import type { Understanding } from '@/services/api';

type PlaybackNotesProps = {
  positionSec: number;
  durationSec: number | null;
  understanding: Understanding | null;
  readStatus?: 'loading' | 'ready' | 'failed';
  onJump: (timestampSec: number) => void;
  onSave: (content: string, timestampSec: number) => Promise<void>;
};

export function PlaybackNotes({ positionSec, durationSec, understanding, readStatus = 'ready', onJump, onSave }: PlaybackNotesProps): ReactElement {
  const [follow, setFollow] = useState(true);
  const [draft, setDraft] = useState('');
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saveLock = useRef(false);
  const sections = useMemo(() => playbackSections(understanding?.knowledgePoints ?? [], durationSec), [understanding, durationSec]);
  const readMessage = readStatus === 'failed' ? '解析依据读取失败，可使用上方独立重试。' : '正在读取解析依据…';
  const active = currentPlaybackSection(sections, positionSec);
  const visible = follow ? (active ? [active] : []) : sections;
  const transcript = understanding?.transcriptSegments.filter((segment) => segment.startMs <= positionSec * 1000 && positionSec * 1000 < segment.endMs) ?? [];

  const save = async (): Promise<void> => {
    if (saveLock.current || !draft.trim() || draftTime === null) return;
    saveLock.current = true;
    setSaving(true); setError(''); setSaved(false);
    try {
      await onSave(draft.trim(), draftTime);
      setDraft(''); setDraftTime(null); setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally { saveLock.current = false; setSaving(false); }
  };

  return <section aria-label="播放同步笔记" className="rounded-xl border border-brand/30 bg-surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">播放同步笔记</h2><p className="mt-1 text-xs leading-5 text-textSub">提前解析，随播放展示重点与原文。</p></div>
      <span className="rounded-full bg-brand-soft px-3 py-2 font-mono text-sm text-brand-ink">播放 {playbackTimeLabel(positionSec)}</span>
    </div>
    <div className="mt-4 flex gap-2">
      <button type="button" aria-pressed={follow} onClick={() => setFollow(true)} className={`min-h-11 rounded-lg border px-3 text-sm ${follow ? 'border-brand bg-brand text-bg' : 'border-glass-line text-textSub'}`}>跟随播放</button>
      <button type="button" aria-pressed={!follow} onClick={() => setFollow(false)} className={`min-h-11 rounded-lg border px-3 text-sm ${!follow ? 'border-brand bg-brand text-bg' : 'border-glass-line text-textSub'}`}>全部重点 · {readStatus === 'ready' ? sections.length : '—'}</button>
    </div>
    <div className="mt-4 max-h-80 space-y-3 overflow-auto">
      {readStatus === 'ready' && visible.map((section) => <article key={section.timestampSec} aria-current={active?.timestampSec === section.timestampSec ? 'true' : undefined} className={`rounded-lg border p-3 ${active?.timestampSec === section.timestampSec ? 'border-brand bg-brand-soft' : 'border-glass-line'}`}>
        <button type="button" onClick={() => onJump(section.timestampSec)} className="min-h-11 text-sm font-medium text-brand-ink">回看 {playbackTimeLabel(section.timestampSec)}</button>
        {section.points.map((point) => <div key={point.pointId} className="mt-2"><h3 className="text-sm font-semibold">{point.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-textSub">{point.summary}</p></div>)}
        <p className="mt-3 text-xs leading-5 text-textMute">来源定位起的重点，展示至下一重点。</p>
      </article>)}
      {readStatus !== 'ready' ? <p role="status" className="text-sm text-textSub">{readMessage}</p> : !sections.length ? <p className="rounded-lg bg-amber-soft p-3 text-sm leading-6 text-textSub">暂无带视频时间引用的 AI 重点。可查看下方完整 AI 笔记或先补充自己的笔记。</p> : follow && !active ? <p className="text-sm leading-6 text-textSub">还未播放到首个重点，可在“全部重点”中提前浏览。</p> : null}
    </div>
    <div className="mt-4 rounded-lg border border-glass-line bg-bg p-3"><h3 className="text-xs font-medium text-teal">当前转写原文</h3>{readStatus !== 'ready' ? <p className="mt-2 text-xs text-textMute">{readMessage}</p> : transcript.length ? transcript.map((segment) => <p key={segment.segmentId} className="mt-2 text-sm leading-6 text-textSub">{segment.text}</p>) : <p className="mt-2 text-xs leading-5 text-textMute">此时间没有可用转写片段。</p>}</div>
    <div className="mt-5 border-t border-glass-line pt-4">
      <label htmlFor="playback-note-draft" className="text-sm font-medium">补充我的笔记</label>
      <p className="mt-1 text-xs leading-5 text-textSub">{draftTime === null ? '开始输入时绑定播放时间，独立保存到“我的笔记”。' : `这条补充绑定 ${playbackTimeLabel(draftTime)}，播放和拖动不会改变定位。`}</p>
      <textarea id="playback-note-draft" maxLength={5000} disabled={saving} value={draft} onChange={(event) => {
        if (draftTime === null && event.target.value.length > 0) setDraftTime(Math.floor(Math.max(0, positionSec)));
        setDraft(event.target.value); setSaved(false);
      }} placeholder="记下你对当前片段的理解…" className="mt-3 min-h-24 w-full rounded-lg border border-glass-line bg-bg p-3 text-sm outline-none focus:border-brand disabled:opacity-50" />
      <div className="mt-2 flex items-center justify-between gap-3"><span role="status" className="text-xs text-teal">{saving ? '正在保存…' : saved ? '已保存到我的笔记' : `${draft.length}/5000`}</span><button type="button" disabled={saving || !draft.trim()} onClick={() => void save()} className="min-h-11 rounded-lg bg-brand px-4 text-sm text-bg disabled:opacity-50">{saving ? '保存中…' : '保存补充'}</button></div>
      {error ? <p role="alert" className="mt-2 text-sm text-rose">{error} 输入和时间已保留。</p> : null}
    </div>
  </section>;
}
