'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { books } from '@/services/books';
import { api, type ContentSummary, type Progress } from '@/services/api';

function formatTime(seconds: number): string {
  const value = Math.floor(seconds);
  const minutes = Math.floor(value / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : `${minutes}:${String(value % 60).padStart(2, '0')}`;
}

const aiLabels: Record<ContentSummary['understandingStatus'], string> = {
  none: '尚未整理', running: '正在整理笔记', completed: '笔记已就绪', failed: '整理失败，原资料仍可学习',
};

export function ContentStudyMeta({ item }: { item: ContentSummary }): ReactElement {
  const [epubCursor, setEpubCursor] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const { contentId, contentType, status, durationSec, pageCount } = item;
  useEffect(() => {
    let active = true;
    setProgress(null); setError(''); setLoading(true);
    if (status !== '已就绪') { setLoading(false); return () => { active = false; }; }
    if (item.format === 'EPUB') {
      void books.read(contentId).then((value): void => { if (active) setEpubCursor(value.book?.cursor ?? null); }).catch((): void => { if (active) setError('章节续读位置读取失败'); }).finally((): void => { if (active) setLoading(false); });
      return (): void => { active = false; };
    }
    void api.progress(contentId).then((value) => {
      if (!active) return;
      const valid = value.contentType === contentType && (value.contentType === 'video'
        ? Number.isFinite(value.positionSec) && value.positionSec >= 0 && (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0 || value.positionSec <= durationSec)
        : Number.isSafeInteger(value.page) && value.page >= 1 && (pageCount == null || !Number.isSafeInteger(pageCount) || pageCount <= 0 || value.page <= pageCount));
      if (!valid || (value.lastStudiedAt !== null && !Number.isFinite(Date.parse(value.lastStudiedAt)))) throw new Error('续学位置无效');
      setProgress(value);
    }).catch(() => { if (active) setError('续学位置读取失败'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contentId, contentType, status, durationSec, pageCount, revision, item.format]);

  let position = '资料尚未就绪';
  if (status === '已就绪') {
    position = loading ? '正在读取学习位置…' : error ? '' : !progress?.lastStudiedAt ? '尚未开始学习' : progress.contentType === 'video' ? `上次看到 ${formatTime(progress.positionSec)}` : `上次读到第 ${progress.page} 页`;
  }
  if (item.format === 'EPUB' && status === '已就绪') position = loading ? '正在读取章节位置…' : error ? '' : epubCursor ? `从全书第 ${epubCursor} 段继续` : '进入学习后建立书籍目录';
  return <div className="mt-3 space-y-2 text-xs text-textSub">
    <p>{item.format === 'EPUB' ? 'EPUB · 按章节/段落阅读，无固定页数' : contentType === 'video' ? `时长：${typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0 ? formatTime(durationSec) : '未知'}` : `页数：${typeof pageCount === 'number' && Number.isSafeInteger(pageCount) && pageCount > 0 ? `${pageCount} 页` : '未知'}`}</p>
    <p className={item.understandingStatus === 'failed' ? 'text-rose' : item.understandingStatus === 'completed' ? 'text-teal' : ''}>AI：{item.format === 'EPUB' ? '可在章节阅读区选段生成原文要点' : aiLabels[item.understandingStatus]}</p>
    {position && <p role={loading && status === '已就绪' ? 'status' : undefined}>{position}</p>}
    {error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-rose">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="min-h-11 text-brand-ink">重试学习位置</button></div>}
  </div>;
}
