'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { api, type AgentResult } from '@/services/api';

function initialTime(): string {
  const date = new Date(Date.now() + 5 * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AgentActions({ result, onPractice, onBusyChange }: { result: AgentResult; onPractice: (result: AgentResult) => void; onBusyChange: (busy: boolean) => void }): ReactElement {
  const [scheduledAt, setScheduledAt] = useState(initialTime);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const active = useRef(true);
  const attemptedTime = useRef('');
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const save = async (): Promise<void> => {
    if (!result.plan || pending.current || saved || uncertain) return;
    const date = new Date(scheduledAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { setError('请选择未来的学习时间。'); return; }
    pending.current = true; setBusy(true); onBusyChange(true); setError('');
    attemptedTime.current = date.toISOString();
    try {
      await api.createStudyPlan({ contentId: result.contentId, title: result.plan.title, targetMinutes: result.plan.targetMinutes, scheduledAt: attemptedTime.current, remindAt: attemptedTime.current });
      if (active.current) setSaved(true);
    } catch (reason: unknown) {
      if (active.current) { setUncertain(true); setError(`${reason instanceof Error ? reason.message : '保存失败'}。时间与方案已保留，请先核对保存状态。`); }
    } finally { pending.current = false; if (active.current) { setBusy(false); onBusyChange(false); } }
  };
  const verify = async (): Promise<void> => {
    if (!result.plan || pending.current || !uncertain) return;
    pending.current = true; setBusy(true); onBusyChange(true);
    try {
      for (let page = 1; page <= 100; page += 1) {
        const list = await api.studyPlans(page);
        if (list.items.some((item) => item.contentId === result.contentId && item.title === result.plan?.title && item.targetMinutes === result.plan?.targetMinutes && Date.parse(item.scheduledAt) === Date.parse(attemptedTime.current))) {
          if (active.current) { setSaved(true); setUncertain(false); setError(''); } return;
        }
        if (page * list.pageSize >= list.total) { if (active.current) { setUncertain(false); setError('未找到本次计划，可以重试保存。'); } return; }
        if (!list.items.length) break;
      }
      throw new Error('计划列表未完整读完，请前往学习计划核对');
    } catch (reason: unknown) { if (active.current) setError(reason instanceof Error ? reason.message : '状态核对失败，请稍后重试'); }
    finally { pending.current = false; if (active.current) { setBusy(false); onBusyChange(false); } }
  };
  return <div className="mt-4 space-y-4 border-t border-glass-line pt-4">
    <h4 className="text-sm font-semibold">下一步行动</h4>
    {result.practice.length ? (
      <section aria-label="实际推荐练习" className="rounded-xl border border-glass-line p-4">
        <h5 className="text-sm font-semibold">实际推荐练习 · {result.practice.length} 题</h5>
        <p className="mt-2 text-xs leading-5 text-textSub">先自己作答，再根据实际结果调整建议。</p>
        <ol className="my-3 space-y-2 text-sm leading-6 text-textSub">
          {result.practice.map((question, index) => <li key={question.exerciseId}>{index + 1}. {question.pointTitle} · {question.question}</li>)}
        </ol>
        <button type="button" disabled={busy} onClick={() => onPractice(result)} className="min-h-11 rounded-lg border border-brand px-4 py-2 text-sm text-brand-ink disabled:opacity-50">开始针对练习 · {result.practice.length} 题</button>
      </section>
    ) : <p className="text-sm leading-6 text-textSub">本次没有推荐练习。<Link href={'/question-bank?contentId=' + encodeURIComponent(result.contentId)} className="ml-2 inline-flex min-h-11 items-center text-brand-ink underline">查看这份资料的题库</Link></p>}
    {result.plan && <section aria-label="复习方案预览" className="min-w-0 rounded-xl border border-glass-line p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">复习方案</h5><span className="rounded-full bg-brand-soft px-3 py-1 text-xs text-brand-ink">{saved ? '已保存计划' : uncertain ? '保存状态待核对' : '预览 · 尚未保存'} · {result.plan.targetMinutes} 分钟</span></div>
      <p className="font-semibold">{result.plan.title} · {result.plan.targetMinutes} 分钟</p>
      <ol className="mt-3 space-y-3 text-sm">{result.plan.steps.map((step, index) => <li key={index}><strong>{index + 1}. {step.title} · {step.minutes}分钟</strong><p className="mt-1 text-xs text-textSub">{step.pointTitles.length ? step.pointTitles.join('、') : '综合复习步骤'}</p></li>)}</ol>
      <p className="mt-3 text-xs leading-5 text-textSub">保存目标、时长与提醒到学习计划；详细步骤和会话保留在本页，刷新会清空。</p>
      {saved ? <p role="status" className="mt-3 text-sm text-brand-ink">计划已保存。<Link href="/study-plans" className="ml-2 underline">查看学习计划</Link></p> : <>
        <label className="mt-3 block text-sm">学习时间<input aria-label="学习时间" type="datetime-local" value={scheduledAt} disabled={busy || uncertain} onChange={(event) => setScheduledAt(event.target.value)} className="mt-2 block min-h-11 w-full min-w-0 rounded-lg border border-glass-line bg-surface p-2" /></label>
        <button type="button" disabled={busy || uncertain} onClick={() => void save()} className="mt-3 min-h-11 rounded-lg bg-brand px-4 py-2 text-sm text-bg disabled:opacity-50">{busy ? '正在处理…' : '确认保存到学习计划'}</button>
        {uncertain && <button type="button" disabled={busy} onClick={() => void verify()} className="ml-2 mt-3 min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50">核对保存状态</button>}
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-rose">{error}</p>}
    </section>}
    <details className="rounded-xl bg-brand-soft px-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">本次已执行 {result.steps.length} 步工具</summary><ol className="space-y-2 pb-4 text-xs leading-6 text-textSub">{result.steps.map((step, index) => <li key={index}>{index + 1}. {step.label} · {step.summary}</li>)}</ol></details>
  </div>;
}
