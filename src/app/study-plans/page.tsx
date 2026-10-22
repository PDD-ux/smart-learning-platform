'use client';
import Link from 'next/link';
import { use, useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { isRoutePromise } from '@/lib/domain/route-params';
import { AppShell } from '@/components/app/AppShell';
import { api, type ContentSummary, type PlanList, type StudyPlan } from '@/services/api';
import { resolveContentSelection } from '@/lib/domain/content-selection';
function planTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
function planGroups(items: StudyPlan[]): { title: string; items: StudyPlan[] }[] {
  return [
    { title: '提醒已到 · 未完成', items: items.filter((plan) => !plan.completedAt && plan.isDue) },
    { title: '待学习', items: items.filter((plan) => !plan.completedAt && !plan.isDue) },
    { title: '已完成', items: items.filter((plan) => !!plan.completedAt) },
  ];
}
function StudyPlansWorkspace({ searchParams = {} }: { searchParams?: { contentId?: string | string[] } } = {}): ReactElement {
  const requestedContent = searchParams.contentId;
  const appliedSelection = useRef<unknown>(Symbol());
  const [selectionError, setSelectionError] = useState('');
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [data, setData] = useState<PlanList | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [contentId, setContentId] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [schedule, setSchedule] = useState('');
  const [reminder, setReminder] = useState('');
  const [revision, setRevision] = useState(0);
  const [contentRevision, setContentRevision] = useState(0);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState('');
  const [planError, setPlanError] = useState('');
  const mutationPending = useRef(false);
  useEffect(() => { let active = true; setContentLoading(true); setContentError(''); void api.contents().then((r) => {
    if (!active) return;
    setContents(r.items);
    if (appliedSelection.current !== requestedContent) {
      const selection = resolveContentSelection(r.items, requestedContent);
      setContentId(selection.contentId); setSelectionError(selection.error); appliedSelection.current = requestedContent;
    }
  }).catch(() => { if (active) setContentError('计划资料读取失败'); }).finally(() => { if (active) setContentLoading(false); }); return () => { active = false; }; }, [contentRevision, requestedContent]);
  useEffect(() => { let active = true; setData(null); setPlanError(''); void api.studyPlans(page).then((r) => { if (!active) return; const lastPage = Math.max(1, Math.ceil(r.total / r.pageSize)); if (page > lastPage) { setPage(lastPage); return; } setData(r); }).catch(() => { if (active) setPlanError('计划读取失败'); }); return () => { active = false; }; }, [page, revision]);
  async function mutate(action: () => Promise<unknown>, successMessage: string): Promise<void> {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(successMessage); setData(null); setRevision((value) => value + 1); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); } finally { mutationPending.current = false; setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await mutate(async () => {
      await api.createStudyPlan({ contentId, title, targetMinutes: minutes, scheduledAt: new Date(schedule).toISOString(), remindAt: new Date(reminder).toISOString() });
      setTitle(''); if (page !== 1) setPage(1);
    }, '计划已创建，提醒将在我的学习显示。');
  }
  return <AppShell title="学习计划" subtitle="安排下一次学习，在工作台查看提醒。">
    <h1 className="mb-4 text-2xl font-semibold">学习计划</h1>
    <section aria-labelledby="study-check-in-title" className="dashboard-section mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <span className="section-kicker">STUDY CHECK-IN · OPTIONAL</span>
        <h2 id="study-check-in-title" className="section-title mt-2">每日打卡与人脸登录设置</h2>
        <p className="section-description mt-2">密码登录后在我的学习一键普通打卡；人脸登录成功自动打卡。每天只记一次，完成学习后仍需勾选计划。</p>
      </div>
      <Link href="/attendance" className="inline-flex min-h-11 items-center rounded-lg border border-brand px-5 py-3 font-medium text-brand-ink">进入每日打卡与人脸登录设置 →</Link>
    </section>
    {error && <p role="alert" className="mb-4 text-rose">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg bg-brand-soft p-3">{notice}</p>}
    {selectionError && <p role="alert" className="mb-4 text-rose">{selectionError}</p>}
    {contentLoading ? <p role="status">正在读取计划资料…</p> : contentError ? <div role="alert">{contentError}<button type="button" className="min-h-11 text-brand-ink" onClick={() => setContentRevision((value) => value + 1)}>重试计划资料</button></div> : contents.length === 0 ? <p>暂无可关联的资料，可先到学习中心导入。</p> : null}
    <form onSubmit={(e) => void create(e)} className="dashboard-section">
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label>计划名称<input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>
      <label>关联资料<select required value={contentId} onChange={(e): void => { setContentId(e.target.value); setSelectionError(''); }} className="mt-2 w-full rounded-lg border p-3"><option value="">请选择资料</option>{contents.map((c) => <option key={c.contentId} value={c.contentId}>{c.title}</option>)}</select></label>
      <label>目标分钟<input type="number" required min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-2 w-full rounded-lg border p-3" /></label>
      <label>学习时间<input type="datetime-local" required value={schedule} onChange={(e) => { setSchedule(e.target.value); if (!reminder) setReminder(e.target.value); }} className="mt-2 w-full rounded-lg border p-3" /></label>
      <label>提醒时间<input type="datetime-local" required max={schedule || undefined} value={reminder} onChange={(e) => setReminder(e.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>
      <button disabled={busy || contentLoading || !!contentError || contents.length === 0} className="rounded-lg bg-brand p-3 text-bg disabled:opacity-50">创建计划</button>
      <p className="text-sm text-textSub sm:col-span-2">提醒会在登录后的我的学习显示；完成学习后手动勾选计划。</p>
      </fieldset>
    </form>
    <section className="dashboard-section mt-6">
      <h2 className="mb-4 font-semibold">我的计划{data ? ` · 已完成 ${data.summary.completedPlans} / ${data.summary.totalPlans}` : ''}</h2>
      <p className="mb-4 text-sm text-textSub">以下分组仅统计本页。提醒已到不代表学习逾期；目标分钟是计划安排，并非实际学习时长。日期均为北京时间。</p>
      {planError ? <div role="alert">{planError}<button type="button" className="min-h-11 text-brand-ink" onClick={() => setRevision((value) => value + 1)}>重试计划列表</button></div> : !data ? <p role="status">正在加载计划…</p> : data.items.length === 0 ? <div><p>暂无计划，先安排一次学习吧。</p><Link href="/import" className="inline-flex min-h-11 items-center text-brand-ink">去学习中心选择资料 →</Link></div> : planGroups(data.items).filter((group) => group.items.length > 0).map((group) => <section key={group.title} aria-label={group.title} className="mb-6">
        <h3 className="mb-3 font-semibold">{group.title} · 本页 {group.items.length} 项</h3>
        {group.items.map((p) => <article key={p.planId} className="mb-3 rounded-lg border border-glass-line p-4">
          <strong className="break-words">{p.title}</strong><p className="my-2 break-words text-sm text-textSub">{p.contentTitle} · 目标 {p.targetMinutes} 分钟</p>
          <p className="text-sm text-textSub">学习时间：{planTime(p.scheduledAt)}</p>
          <p className="my-2 text-sm text-textSub">提醒时间：{planTime(p.remindAt)}</p>
          {p.completedAt && <p className="mb-2 text-sm">确认完成：{planTime(p.completedAt)}</p>}
          <div className="flex flex-wrap gap-3"><Link className="inline-flex min-h-11 items-center rounded-lg border px-3 text-brand-ink" href={'/study/' + p.contentId}>进入学习</Link>
            <button className="min-h-11 rounded-lg border px-3 disabled:opacity-50" disabled={busy} onClick={() => void mutate(() => api.completeStudyPlan(p.planId, !p.completedAt), p.completedAt ? '已撤销完成，计划恢复为未完成。' : '已确认计划完成，可随时撤销。')}>{p.completedAt ? '撤销完成' : '标记完成'}</button>
            <button disabled={busy} className="min-h-11 px-3 text-rose disabled:opacity-50" onClick={() => { if (window.confirm('删除这条学习计划？')) void mutate(() => api.deleteStudyPlan(p.planId), '计划已删除。'); }}>删除</button></div>
        </article>)}
      </section>)}
      <div className="mt-4 flex flex-wrap items-center gap-4"><button className="min-h-11 disabled:opacity-50" disabled={!data || page <= 1 || busy} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button className="min-h-11 disabled:opacity-50" disabled={!data || page * data.pageSize >= data.total || busy} onClick={() => setPage(page + 1)}>下一页</button><Link className="inline-flex min-h-11 items-center text-brand-ink" href="/review">查看复习巩固 →</Link></div>
    </section>
  </AppShell>;
}

type PlanSearch = { contentId?: string | string[] };
export default function StudyPlansPage(props: { searchParams?: PlanSearch }): ReactElement;
export default function StudyPlansPage(props: { searchParams?: Promise<PlanSearch> }): ReactElement;
export default function StudyPlansPage(props: { searchParams?: PlanSearch | Promise<PlanSearch> }): ReactElement {
  const searchParams = isRoutePromise(props.searchParams) ? use(props.searchParams) : props.searchParams;
  return <StudyPlansWorkspace key={JSON.stringify(searchParams?.contentId ?? null)} searchParams={searchParams} />;
}

