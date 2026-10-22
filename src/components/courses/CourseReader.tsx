'use client';
/* eslint-disable @next/next/no-img-element -- Authenticated, no-store page images must not pass through the shared Next image cache. */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ContentRef } from '@/lib/domain/content-ref';
import { isRefInRange } from '@/lib/domain/content-ref';
import type { CourseDetail } from '@/services/api';

export function CourseReader({ course, initialRef = null, requestedRef = null }: { course: CourseDetail; initialRef?: ContentRef | null; requestedRef?: ContentRef | null }): ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const [page, setPage] = useState(initialRef?.type === 'document' ? initialRef.page : 1);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect((): void => {
    if (!requestedRef || !isRefInRange(requestedRef, course) || (requestedRef.type === 'video') !== (course.contentType === 'video')) return;
    if (requestedRef.type === 'document') { setPage(requestedRef.page); setError(''); }
    else if (video.current && video.current.readyState >= 1) { video.current.pause(); video.current.currentTime = requestedRef.timestampSec; }
  }, [requestedRef, course]);
  function locate(ref: ContentRef): void {
    if (!isRefInRange(ref, course) || (ref.type === 'video') !== (course.contentType === 'video')) return;
    if (ref.type === 'video' && video.current) { video.current.pause(); video.current.currentTime = ref.timestampSec; }
    if (ref.type === 'document') { setError(''); setPage(ref.page); }
  }
  function refButton(ref: ContentRef, key: string): ReactElement {
    return <button key={key} onClick={(): void => locate(ref)}>{ref.type === 'video' ? `回看 ${Math.floor(ref.timestampSec / 60)}:${String(ref.timestampSec % 60).padStart(2, '0')}` : `回看第 ${ref.page} 页`}</button>;
  }
  const mediaFailed = (): void => setError('媒体读取失败或课程已下架。请刷新课程状态后重试。');
  return <div className="shared-reader">
    <section aria-label="共享课程媒体" className="shared-course-card">
      {course.contentType === 'video' ? <video key={reload} ref={video} controls preload="metadata" src={course.resourceUrl} onError={mediaFailed} onLoadedMetadata={(): void => { const target = requestedRef ?? initialRef; if (target?.type === 'video') locate(target); }} aria-label="共享课堂视频" /> : course.format === 'pdf' ? <><div className="shared-course-actions"><span>PDF · 第 {page} / {course.pageCount} 页</span><button disabled={page <= 1} onClick={(): void => { setError(''); setPage((value): number => value - 1); }}>上一页</button><button disabled={page >= (course.pageCount ?? 1)} onClick={(): void => { setError(''); setPage((value): number => value + 1); }}>下一页</button></div><img key={`${page}:${reload}`} src={course.resourceUrl.replace(/\/media$/, `/pages/${page}`)} alt={`${course.title} 第 ${page} 页`} onError={mediaFailed} /></> : ['png', 'jpg', 'jpeg'].includes(course.format) ? <img key={reload} src={course.resourceUrl} alt={course.title} onError={mediaFailed} /> : <iframe key={reload} sandbox="" title="共享文档原文（只读）" src={course.resourceUrl} onError={mediaFailed} />}
      {error ? <p role="alert">{error}</p> : null}<button onClick={(): void => { setError(''); setReload((value): number => value + 1); }}>重试媒体读取</button>
      <p>平台共享内容 · 只读。本页不写入个人学习进度或成绩，不能在这里生成AI内容。下架后新读取会被拒绝，已接收的内容无法撤回。</p>
    </section>
    <section aria-label="共享课程解析快照" className="shared-course-card"><h2>已选择公开的解析内容</h2><p>以下为发布时的独立快照，不跟随原资料修改；未选内容不显示。AI整理需与原文核对。</p>
      {course.snapshot.knowledgePoints.length ? <div><h3>知识重点 · {course.snapshot.knowledgePoints.length}</h3>{course.snapshot.knowledgePoints.map((point, index): ReactElement => <article key={index}><h4>{point.title}</h4><p className="shared-course-text">{point.summary}</p><div className="shared-course-actions">{point.refs.map((ref, refIndex): ReactElement => refButton(ref, String(refIndex)))}</div></article>)}</div> : null}
      {course.snapshot.generatedNote ? <div><h3>已有AI整理笔记 · 需核对</h3><p>原生成时间：{new Date(course.snapshot.generatedNote.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {course.snapshot.generatedNote.sourceCount} 条来源</p><div className="shared-course-text">{course.snapshot.generatedNote.markdown}</div></div> : null}
      {course.snapshot.transcripts.length ? <details><summary>转写原文 · {course.snapshot.transcripts.length} 段</summary>{course.snapshot.transcripts.map((item, index): ReactElement => <article key={index}>{refButton({ type: 'video', timestampSec: Math.floor(item.startMs / 1000) }, String(index))}<p className="shared-course-text">{item.text}</p></article>)}</details> : null}
      {course.snapshot.textBlocks.length ? <details><summary>正文 / OCR · {course.snapshot.textBlocks.length} 块</summary>{course.snapshot.textBlocks.map((item, index): ReactElement => <article key={index}>{refButton(item.ref, String(index))}<p className="shared-course-text">{item.text}</p></article>)}</details> : null}
      {!course.snapshot.knowledgePoints.length && !course.snapshot.generatedNote && !course.snapshot.transcripts.length && !course.snapshot.textBlocks.length ? <p>本课程仅公开原媒体，未选择公开解析内容。</p> : null}
    </section>
  </div>;
}
