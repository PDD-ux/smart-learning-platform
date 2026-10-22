'use client';
import Link from 'next/link';
import { use, useEffect, useState, type ReactElement } from 'react';
import { isRoutePromise } from '@/lib/domain/route-params';
import { AppShell } from '@/components/app/AppShell';
import { CourseReader } from '@/components/courses/CourseReader';
import { CourseDiscussion } from '@/components/courses/CourseDiscussion';
import { MyDiscussionReports } from '@/components/courses/DiscussionReports';
import type { ContentRef } from '@/lib/domain/content-ref';
import { resolveStudyLocation } from '@/lib/domain/study-location';
import { discussionLocation } from '@/lib/domain/discussion-location';
import { api, type CourseDetail } from '@/services/api';
type CourseSearch = Record<string, string | string[] | undefined>;
export default function CoursePage(props: { params: { id: string }; searchParams?: CourseSearch }): ReactElement;
export default function CoursePage(props: { params: Promise<{ id: string }>; searchParams?: Promise<CourseSearch> }): ReactElement;
export default function CoursePage(props: { params: { id: string } | Promise<{ id: string }>; searchParams?: CourseSearch | Promise<CourseSearch> }): ReactElement {
  const params = isRoutePromise(props.params) ? use(props.params) : props.params;
  const searchParams = isRoutePromise(props.searchParams) ? use(props.searchParams) : props.searchParams;
  return <CourseWorkspace params={params} searchParams={searchParams} />;
}
function CourseWorkspace({ params, searchParams }: { params: { id: string }; searchParams?: CourseSearch }): ReactElement {
  const [course, setCourse] = useState<CourseDetail | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'content' | 'discussion'>('content'), [requestedRef, setRequestedRef] = useState<ContentRef | null>(null);
  const targetThread = discussionLocation(searchParams?.thread);
  useEffect((): void => { setTab(targetThread ? 'discussion' : 'content'); setRequestedRef(null); }, [params.id, targetThread]);
  useEffect(() => { let active = true; setCourse(null); setError(''); void api.course(params.id).then((value): void => { if (active) setCourse(value); }).catch((): void => { if (active) setError('课程不存在、已下架或暂时无法读取。请刷新课程状态。'); }); return (): void => { active = false; }; }, [params.id, revision]);
  return <AppShell title="共享课程"><div className="shared-courses"><Link className="learner-text-action" href="/import">← 返回学习中心</Link><header><span>平台共享内容 · 只读学习</span><h1>{course?.title ?? '共享课程'}</h1>{course ? <p>{course.description}</p> : null}<button onClick={(): void => setRevision((value): number => value + 1)}>刷新课程状态</button></header>{error ? <p role="alert">{error}</p> : course ? <>
    {course.discussionAvailable ? <nav className="shared-course-actions" aria-label="共享课程功能"><button aria-pressed={tab === 'content'} onClick={(): void => setTab('content')}>课程内容</button><button aria-pressed={tab === 'discussion'} onClick={(): void => setTab('discussion')}>课程讨论</button></nav> : null}
    <div hidden={tab !== 'content' && course.discussionAvailable}><CourseReader key={`${course.courseId}:${revision}:${JSON.stringify(searchParams ?? {})}`} course={course} initialRef={resolveStudyLocation(searchParams ?? {}, course)} requestedRef={requestedRef} /></div>
    {course.discussionAvailable ? <div hidden={tab !== 'discussion'}><CourseDiscussion key={course.courseId} course={course} initialThread={targetThread} onLocate={(ref): void => { setRequestedRef({ ...ref }); setTab('content'); }} /><MyDiscussionReports /></div> : null}
  </> : <p role="status">正在读取课程…</p>}</div></AppShell>;
}
