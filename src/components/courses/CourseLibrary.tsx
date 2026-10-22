'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { api, type CourseList } from '@/services/api';
export function CourseLibrary(): ReactElement {
  const [q, setQ] = useState(''), [filter, setFilter] = useState({ q: '', page: 1 }), [revision, setRevision] = useState(0);
  const [result, setResult] = useState<CourseList | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true); setError(''); setResult(null); void api.courses(filter.page, filter.q).then((value): void => { if (active) setResult(value); }).catch((): void => { if (active) setError('共享课程读取失败，请重试'); }).finally((): void => { if (active) setLoading(false); }); return (): void => { active = false; }; }, [filter, revision]);
  return <section className="shared-courses" aria-label="平台共享课程"><h1>平台共享课程</h1><p>管理员持有授权并明确发布的独立内容，只读学习；你的私人资料与笔记不会自动出现在这里。</p><form onSubmit={(event): void => { event.preventDefault(); setFilter({ q: q.trim(), page: 1 }); }}><label>搜索共享课程<input maxLength={120} value={q} onChange={(event): void => setQ(event.target.value)} /></label><button>搜索课程</button><button type="button" disabled={loading} onClick={(): void => setRevision((value): number => value + 1)}>刷新共享课程</button></form>
    {loading ? <p role="status">正在读取共享课程…</p> : error ? <p role="alert">{error}</p> : result ? <><p>已发布 · {result.total} 门</p>{result.items.length === 0 ? <p>当前范围暂无已发布课程。你仍可以切回“我的资料”继续个人学习。</p> : <div className="shared-course-grid">{result.items.map((course): ReactElement => <article key={course.courseId} className="shared-course-card"><span>平台共享内容 · {course.contentType === 'video' ? '视频' : '文档'}</span><h3>{course.title}</h3><p>{course.description || '暂无课程简介'}</p><Link href={`/courses/${course.courseId}`} className="learner-text-action">阅读共享课程 →</Link></article>)}</div>}<nav aria-label="共享课程分页"><button disabled={result.page <= 1} onClick={(): void => setFilter((previous) => ({ ...previous, page: previous.page - 1 }))}>上一页</button><span>第 {result.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页</span><button disabled={result.page * result.pageSize >= result.total} onClick={(): void => setFilter((previous) => ({ ...previous, page: previous.page + 1 }))}>下一页</button></nav></> : null}
  </section>;
}
