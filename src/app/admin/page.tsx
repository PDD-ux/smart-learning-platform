'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { api, ApiClientError, type AdminOverview } from '@/services/api';

function roleLabel(role: 'admin' | 'teacher' | 'student'): string {
  return role === 'admin' ? '管理员' : role === 'teacher' ? '教师' : '学习者';
}

function formatShanghaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function OverviewSkeleton(): ReactElement {
  return <div aria-label="正在加载管理员概况" aria-busy="true" className="space-y-6">
    <div className="h-36 animate-pulse rounded-lg border border-glass-line bg-surface" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg border border-glass-line bg-surface" />)}</div>
    <div className="h-56 rounded-lg border border-glass-line bg-surface" />
  </div>;
}

type LoadMode = 'initial' | 'refresh';

export default function AdminOverviewPage(): ReactElement {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const requestInFlight = useRef(false);

  const load = useCallback(async (mode: LoadMode): Promise<void> => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError('');

    try {
      setOverview(await api.adminOverview());
      setForbidden(false);
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 403) {
        setOverview(null);
        setForbidden(true);
      } else {
        if (mode === 'initial') setOverview(null);
        setError(reason instanceof Error ? reason.message : '管理员概况加载失败，请重试。');
      }
    } finally {
      requestInFlight.current = false;
      if (mode === 'initial') setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load('initial'); }, [load]);

  return <AdminShell>
    <div className="space-y-6">
      {loading ? <OverviewSkeleton /> : forbidden ? <section className="mx-auto flex min-h-80 max-w-xl items-center justify-center rounded-lg border border-rose/20 bg-surface p-8 text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-soft text-2xl text-rose">!</div><h2 className="mt-5 text-xl font-semibold text-text">没有管理员权限</h2><p className="mt-3 text-sm leading-6 text-textSub">当前账号不能查看平台管理数据。</p><Link href="/dashboard" className="mt-6 inline-flex min-h-11 items-center rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">返回工作台</Link></div></section> : !overview && error ? <section className="rounded-lg border border-rose/20 bg-surface p-8 text-center"><p className="section-kicker">ADMIN · OVERVIEW</p><h2 className="mt-2 text-xl font-semibold text-text">概况暂时无法加载</h2><p role="alert" className="mt-3 text-sm text-rose">{error}</p><button type="button" onClick={() => void load('initial')} className="mt-5 min-h-11 rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">重试</button></section> : overview ? <>
        <section className="rounded-lg border border-glass-line bg-surface p-6 shadow-glass">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div><span className="section-kicker">ADMINISTRATION · {overview.date}</span><h2 className="section-title mt-2">平台管理中心</h2><p className="section-description mt-2">账号与签到概况、常用管理入口集中在这里。</p></div>
            <div className="flex flex-wrap gap-3"><button type="button" aria-busy={refreshing} disabled={refreshing} onClick={() => void load('refresh')} className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand px-5 py-3 text-sm font-medium text-brand-ink disabled:cursor-wait disabled:opacity-60">{refreshing ? '刷新中…' : '刷新概况'}</button><Link href="/admin/users" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">管理用户 <span aria-hidden="true" className="ml-2">→</span></Link><Link href="/admin/attendance" className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand px-5 py-3 text-sm font-medium text-brand-ink">查看签到记录 <span aria-hidden="true" className="ml-2">→</span></Link></div>
          </div>
        </section>
        {error ? <div role="alert" className="flex flex-col gap-3 rounded-md border border-rose/20 bg-rose-soft px-4 py-3 text-sm text-rose sm:flex-row sm:items-center sm:justify-between"><p>刷新失败，仍显示上次成功加载的数据：{error}</p><button type="button" onClick={() => void load('refresh')} className="min-h-10 shrink-0 rounded-md border border-rose/30 px-4 py-2 font-medium">重试刷新</button></div> : null}

        <section aria-label="平台概况" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <article className="rounded-lg border border-glass-line bg-surface p-5 shadow-glass"><p className="text-sm text-textSub">账号总数</p><p className="mt-3 text-3xl font-semibold text-text">{overview.users.total}</p><p className="mt-2 text-xs text-textMute">平台已创建账号</p></article>
          <article className="rounded-lg border border-glass-line bg-surface p-5 shadow-glass"><p className="text-sm text-textSub">学习者</p><p className="mt-3 text-3xl font-semibold text-teal">{overview.users.students}</p><p className="mt-2 text-xs text-textMute">学习者账号数量</p></article>
          <article className="rounded-lg border border-glass-line bg-surface p-5 shadow-glass"><p className="text-sm text-textSub">教师</p><p className="mt-3 text-3xl font-semibold text-text">{overview.users.teachers}</p><p className="mt-2 text-xs text-textMute">教师账号数量</p></article>
          <article className="rounded-lg border border-glass-line bg-surface p-5 shadow-glass"><p className="text-sm text-textSub">管理员</p><p className="mt-3 text-3xl font-semibold text-brand-ink">{overview.users.admins}</p><p className="mt-2 text-xs text-textMute">管理员账号数量</p></article>
          <article className="rounded-lg border border-glass-line bg-surface p-5 shadow-glass"><div className="flex items-center justify-between"><p className="text-sm text-textSub">今日签到</p><span className="rounded-full bg-amber-soft px-2.5 py-1 text-xs text-amber">上海时间</span></div><p className="mt-3 text-3xl font-semibold text-text">{overview.attendance.total}</p><p className="mt-2 text-xs text-textMute">人脸 {overview.attendance.signedIn} · 普通 {overview.attendance.selfCheckIn} · 历史待确认 {overview.attendance.manualConfirmation}</p></article>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <article className="overflow-hidden rounded-lg border border-glass-line bg-surface shadow-glass">
            <div className="flex items-center justify-between border-b border-glass-line px-5 py-4"><div><span className="section-kicker">NEW ACCOUNTS</span><h3 className="mt-1 text-base font-semibold text-text">最近新增账号</h3></div><Link href="/admin/users" className="inline-flex min-h-11 items-center text-sm text-brand-ink hover:underline">打开用户管理 →</Link></div>
            {overview.users.recent.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-medium text-text">还没有账号记录</p><p className="mt-2 text-xs text-textSub">新账号创建后会出现在这里。</p></div> : <div className="divide-y divide-glass-line">{overview.users.recent.map((user) => <div key={user.id} className="grid grid-cols-[minmax(0,1fr)_90px_110px] items-center gap-3 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-text">{user.nickname}</p><p className="mt-1 text-xs text-textMute">{formatShanghaiDateTime(user.createdAt)}</p></div><span className={'w-fit rounded-full px-2.5 py-1 text-xs ' + (user.role === 'admin' ? 'bg-brand-soft text-brand-ink' : 'bg-teal/10 text-teal')}>{roleLabel(user.role)}</span><span className="text-right text-xs text-textMute">已创建</span></div>)}</div>}
          </article>

          <div className="space-y-6">
            <article className="rounded-lg border border-glass-line bg-surface p-5 shadow-glass"><span className="section-kicker">TODAY · {overview.date}</span><h3 className="mt-2 text-base font-semibold text-text">今日签到方式</h3><div className="mt-5 space-y-4"><div className="flex items-center justify-between text-sm"><span className="text-textSub">普通打卡</span><strong className="text-text">{overview.attendance.selfCheckIn} 次</strong></div><div className="flex items-center justify-between text-sm"><span className="text-textSub">人脸核验</span><strong className="text-text">{overview.attendance.signedIn} 次</strong></div><div className="h-2 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-teal" style={{ width: (overview.attendance.total === 0 ? 0 : (overview.attendance.signedIn / overview.attendance.total) * 100) + '%' }} /></div><div className="flex items-center justify-between text-sm"><span className="text-textSub">历史待确认</span><strong className="text-text">{overview.attendance.manualConfirmation} 次</strong></div><div className="h-2 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-amber" style={{ width: (overview.attendance.total === 0 ? 0 : (overview.attendance.manualConfirmation / overview.attendance.total) * 100) + '%' }} /></div></div><Link href="/admin/attendance" className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-brand-ink hover:underline">筛选签到记录 →</Link></article>
            <article className="rounded-lg border border-glass-line bg-brand-soft/40 p-5"><span className="section-kicker">管理范围</span><h3 className="mt-2 text-base font-semibold text-text">只看管理所需信息</h3><p className="mt-2 text-sm leading-6 text-textSub">此处提供账号统计、昵称与角色摘要，以及签到结果统计。学习内容和人脸原始信息不在管理总览中展示。</p></article>
          </div>
        </section>
        <p className="text-right text-xs text-textMute">数据更新于 {formatShanghaiDateTime(overview.generatedAt)}</p>
      </> : null}
    </div>
  </AdminShell>;
}
