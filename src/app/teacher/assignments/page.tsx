'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { TeacherShell } from '@/components/teacher/TeacherShell';
import type { TeacherOverview } from '@/lib/classrooms/teacher-overview';
import { teacher } from '@/services/teacher';

const taskState: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '已发布', CLOSED: '已关闭', WITHDRAWN: '已撤回' };

export default function TeacherAssignmentsPage(): ReactElement {
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try { setOverview(await teacher.overview()); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '作业列表读取失败，请重试。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, retry]);

  const tasks = overview?.reviewQueue.length ? overview.reviewQueue : overview?.recentAssignments ?? [];
  return <TeacherShell><div className="teacher-workspace">
    <header className="teacher-page-heading"><div><p className="section-kicker">TEACHING · REVIEW</p><h1>作业批阅</h1><p>只呈现本人课程的正式提交计数。打开任务后查看提交正文、附件并给出正式反馈。</p></div><Link href="/teacher/classes">查看我的课程 →</Link></header>
    {error ? <section className="teacher-state-card" role="alert"><h2>作业列表暂时无法读取</h2><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></section> : loading ? <section className="teacher-state-card" role="status">正在读取作业状态…</section> : overview ? <>
      <section className="teacher-review-summary"><strong>{overview.summary.pendingReviewCount}</strong><span>份正式提交待批阅</span><small>草稿、已退回和已批阅记录不会计入待批阅数量。</small></section>
      <section className="teacher-panel"><div className="teacher-panel-heading"><div><h2>{overview.reviewQueue.length ? '待处理任务' : '最近任务'}</h2><p>{overview.reviewQueue.length ? `当前展示 ${overview.reviewQueue.length} 项待批阅任务` : '还没有待批阅提交，以下是最近更新的任务。'}</p></div></div>
        {tasks.length ? <div className="teacher-list">{tasks.map((task) => <article key={task.id}><div><h3><Link href={`/teacher/classes/assignments/${encodeURIComponent(task.id)}`}>{task.title}</Link></h3><p>{task.classroomTitle} · {taskState[task.state]}{task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleString('zh-CN', { hour12: false })}` : ' · 未设置截止时间'}</p></div><span>{task.pendingReviews ? `${task.pendingReviews} 份待批阅` : '无待批阅'}</span></article>)}</div> : <div className="teacher-empty"><h3>还没有学习任务</h3><p>先创建班级，再发布章节与作业。学生提交后会出现在本页。</p><Link href="/teacher/classes">去创建班级 →</Link></div>}
      </section>
      {overview.reviewQueue.length >= 50 ? <p className="teacher-updated">这里最多列出50项待批阅任务。请从相应班级继续查看其余任务；总待批阅数仍为准确汇总。</p> : null}
    </> : null}
  </div></TeacherShell>;
}
