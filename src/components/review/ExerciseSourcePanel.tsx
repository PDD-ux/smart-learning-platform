'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { exerciseSource, type ExerciseSource } from '@/lib/domain/exercise-source';
import { playbackTimeLabel } from '@/lib/domain/playback-notes';
import { studyCitationUrl } from '@/lib/domain/study-location';
import { api } from '@/services/api';

type Props = { contentId: string; pointId: string; correct: boolean };

export function ExerciseSourcePanel({ contentId, pointId, correct }: Props): ReactElement {
  const [source, setSource] = useState<ExerciseSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSource(null); setReady(false);
    void Promise.all([api.content(contentId), api.understanding(contentId)]).then(([content, understanding]) => {
      if (!active) return;
      if (content.contentId !== contentId) throw new Error('资料来源不一致，请重新加载');
      const next = exerciseSource(content, understanding, pointId);
      setSource(next); setReady(content.status === '已就绪'); setLoading(false);
    }).catch((reason: unknown) => {
      if (active) { setError(reason instanceof Error ? reason.message : '知识点来源加载失败'); setLoading(false); }
    });
    return () => { active = false; };
  }, [contentId, pointId, revision]);

  return <section aria-label="知识点来源" className="mt-5 rounded-xl border border-brand/30 bg-brand-soft p-4">
    <h3 className="font-semibold">{correct ? '知识点与来源' : '知识点补强'}</h3>
    <p className="mt-1 text-sm text-textSub">回顾关联知识点，再回到原资料核对。</p>
    {loading ? <p role="status" className="mt-3 text-sm">正在加载知识点来源…</p> : error ? <div className="mt-3"><p role="alert" className="text-sm text-rose">{error}</p><button type="button" className="mt-2 min-h-11 rounded-lg border border-brand px-3 text-sm text-brand-ink" onClick={() => setRevision((value) => value + 1)}>重新加载来源</button></div> : <>
      {source ? <><h4 className="mt-3 font-medium">{source.title}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{source.summary}</p></> : <p className="mt-3 text-sm">关联知识点已不存在或已被重新解析替换，无法按原题定位。</p>}
      {ready && source?.refs.length ? <div className="mt-3 flex flex-wrap gap-2">{source.refs.map((ref) => <Link key={ref.type === 'video' ? ref.timestampSec : ref.page} href={studyCitationUrl(contentId, ref)} className="inline-flex min-h-11 items-center rounded-lg border border-brand bg-surface px-3 text-sm text-brand-ink">{ref.type === 'video' ? `回看视频 ${playbackTimeLabel(ref.timestampSec)}` : `查看原文第 ${ref.page} 页`}</Link>)}</div> : source ? <p className="mt-3 text-sm text-textSub">{ready ? '暂无可核对的时间点或页码，可回到原资料查看。' : '原资料尚未就绪，暂时无法回看。'}</p> : null}
      {ready && <Link href={`/study/${encodeURIComponent(contentId)}`} className="mt-3 inline-flex min-h-11 items-center text-sm text-brand-ink underline">打开原资料</Link>}
    </>}
  </section>;
}
