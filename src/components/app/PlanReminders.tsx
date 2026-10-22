'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { api, type StudyPlan } from '@/services/api';
export function PlanReminders(): ReactElement | null {
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<{ totalPlans: number; completedPlans: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let active = true; setSummary(null); setTotal(null); setError('');
    const load = (): void => { void Promise.resolve().then(() => api.studyPlans(1, true)).then((r) => { if (active) { setPlans(r.items); setTotal(r.total); setSummary(r.summary); setError(''); } }).catch(() => { if (active) setError('暂时无法获取学习提醒，请到学习计划查看。'); }); };
    load(); const timer = window.setInterval(load, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [revision]);
  return <section aria-label="学习提醒" className="dashboard-section mb-6"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="font-semibold">学习提醒</h2><Link href="/study-plans" className="inline-flex min-h-11 items-center text-brand-ink">查看待办 →</Link></div>
    {!error && summary && <p className="mt-2 text-sm text-textSub">计划进度：已完成 {summary.completedPlans} / {summary.totalPlans}</p>}
    {!error && summary && total !== null && total !== undefined && total > 0 && <p className="mt-2 text-sm text-textSub">提醒已到的未完成计划共 {total} 条，当前展示 {plans.length} 条。目标分钟是计划安排，不是实际学习时长。</p>}
    {error ? <div role="alert" className="mt-3 text-textSub">{error}<button type="button" className="min-h-11 text-brand-ink" onClick={() => setRevision((value) => value + 1)}>重试学习提醒</button></div> : !summary ? <p role="status">正在读取学习提醒…</p> : plans.length === 0 ? <p className="mt-3 text-textSub">暂时没有到期计划，可以安排下一次学习。</p> : plans.map((p) => <Link className="mt-3 block min-h-11 break-words rounded-lg bg-brand-soft p-3" key={p.planId} href={'/study/' + encodeURIComponent(p.contentId)}>{p.title} · 目标 {p.targetMinutes} 分钟 · {p.contentTitle} →</Link>)}
  </section>;
}

