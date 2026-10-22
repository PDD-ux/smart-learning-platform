'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { TeacherShell } from '@/components/teacher/TeacherShell';
import type { TeacherOverview } from '@/lib/classrooms/teacher-overview';
import { teacher } from '@/services/teacher';

const stateLabels: Record<string, string> = { ACTIVE: '进行中', ARCHIVED: '已归档', DRAFT: '草稿', PUBLISHED: '已发布', CLOSED: '已关闭', WITHDRAWN: '已撤回' };

function TeacherOverviewPage(): ReactElement {
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try { setOverview(await teacher.overview()); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '教学总览读取失败，请重试。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, retry]);

  return <TeacherShell><div className="teacher-workspace">
    <header className="teacher-page-heading"><div><p className="section-kicker">TEACHING · OVERVIEW</p><h1>教学总览</h1><p>先选择一门课程进入课程空间，再管理章节、任务和学生；跨课程批阅见下方待办。</p></div><div className="teacher-page-actions"><Link href="/teacher/classes">课程管理</Link><Link href="/teacher/courses">课程资料</Link></div></header>
    {error ? <section className="teacher-state-card" role="alert"><h2>总览暂时无法读取</h2><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></section> : loading ? <section className="teacher-state-card" role="status">正在读取本人课程…</section> : overview ? <>
      <section className="teacher-course-section" aria-labelledby="teacher-courses-title">
        <div className="teacher-panel-heading"><div><h2 id="teacher-courses-title">我的课程 <span className="teacher-course-count">{overview.classrooms.length}</span></h2><p>每张卡片对应一门由你负责的班级课程；学生使用邀请码加入。</p></div><Link href="/teacher/classes">管理课程与新建 →</Link></div>
        {overview.classrooms.length ? <div className="teacher-course-grid">{overview.classrooms.map((room) => <article className="teacher-course-card" key={room.id}>
          <div className="teacher-course-card-heading"><span className={`teacher-course-state ${room.state === 'ARCHIVED' ? 'is-archived' : ''}`}>{stateLabels[room.state]}</span></div>
          <h3><Link href={`/teacher/classes/${encodeURIComponent(room.id)}`}>{room.title}</Link></h3>
          <dl className="teacher-course-metrics"><div><dt>有效学生</dt><dd>{room.activeMembers}</dd></div><div><dt>学习任务</dt><dd>{room.assignmentCount}</dd></div><div><dt>待批阅</dt><dd>{room.pendingReviewCount}</dd></div></dl>
          <Link className="teacher-course-enter" href={`/teacher/classes/${encodeURIComponent(room.id)}`}>进入课程空间 <span aria-hidden="true">→</span></Link>
        </article>)}</div> : <div className="teacher-empty"><h3>还没有课程</h3><p>创建第一门课程后，会生成邀请码供学生加入；随后可在课程空间发布章节和学习任务。</p><Link href="/teacher/classes">创建第一门课程 →</Link></div>}
      </section>
      <section className="teacher-stat-grid" aria-label="教学数据概况">
        <article><span>我的课程</span><strong>{overview.summary.classroomCount}</strong><small>进行中 {overview.summary.activeClassroomCount}</small></article>
        <article><span>学习任务</span><strong>{overview.summary.assignmentCount}</strong><small>包含草稿和已发布任务</small></article>
        <article><span>待批阅提交</span><strong>{overview.summary.pendingReviewCount}</strong><small>只统计已正式提交的作业</small></article>
      </section>
      <div className="teacher-overview-columns">
        <section className="teacher-panel"><div className="teacher-panel-heading"><div><h2>待批阅</h2><p>来自本人课程的正式提交</p></div><Link href="/teacher/assignments">全部待办 →</Link></div>
          {overview.reviewQueue.length ? <div className="teacher-list">{overview.reviewQueue.slice(0, 6).map((task) => <article key={task.id}><div><h3><Link href={`/teacher/classes/assignments/${encodeURIComponent(task.id)}`}>{task.title}</Link></h3><p>{task.classroomTitle} · {task.dueAt ? `截止 ${new Date(task.dueAt).toLocaleDateString('zh-CN')}` : '未设置截止时间'}</p></div><span>{task.pendingReviews} 份</span></article>)}</div> : <div className="teacher-empty"><h3>目前没有待批阅提交</h3><p>学生正式提交后会出现在这里；草稿不会计入。</p></div>}
        </section>
        <section className="teacher-panel"><div className="teacher-panel-heading"><div><h2>近期任务</h2><p>汇总本人课程的任务状态</p></div><Link href="/teacher/assignments">查看任务 →</Link></div>
          {overview.recentAssignments.length ? <div className="teacher-list">{overview.recentAssignments.slice(0, 6).map((task) => <article key={task.id}><div><h3><Link href={`/teacher/classes/assignments/${encodeURIComponent(task.id)}`}>{task.title}</Link></h3><p>{task.classroomTitle} · {stateLabels[task.state]}{task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleDateString('zh-CN')}` : ''}</p></div><span>{task.pendingReviews ? `${task.pendingReviews} 待批阅` : '无待批阅'}</span></article>)}</div> : <div className="teacher-empty"><p>发布课程任务后，会在这里显示。</p><Link href="/teacher/classes">进入课程管理 →</Link></div>}
        </section>
      </div>
      <p className="teacher-updated">更新于 {new Date(overview.generatedAt).toLocaleString('zh-CN', { hour12: false })} · 作业草稿不会出现在教师看板中</p>
    </> : null}
  </div></TeacherShell>;
}

export default TeacherOverviewPage;
