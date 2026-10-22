'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { ApiClientError } from '@/services/api';
import { attendanceApi, type AttendanceRecord } from '@/services/attendance';

type StatusFilter = '' | AttendanceRecord['status'];

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminAttendancePage(): ReactElement {
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current += 1; }; }, []);
  const pageSize = 10;

  const load = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setLoading(true); setTotal(null);
    setError('');
    try {
      const result = await attendanceApi.list({ page, pageSize, userId: userId.trim() || undefined, status: status || undefined, from: from || undefined, to: to || undefined });
      if (!mounted.current || version !== requestVersion.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setItems(result.items);
      setTotal(result.total);
      setForbidden(false);
    } catch (reason) {
      if (!mounted.current || version !== requestVersion.current) return;
      if (reason instanceof ApiClientError && reason.status === 403) {
        setForbidden(true);
      } else {
        setError(reason instanceof Error ? reason.message : '签到记录加载失败，请稍后重试。');
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [from, page, status, to, userId]);

  useEffect(() => { void load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil((total ?? 0) / pageSize));

  return <AdminShell>
    {forbidden ? <section className="mx-auto flex min-h-96 max-w-xl items-center justify-center rounded-lg border border-rose/20 bg-surface p-8 text-center shadow-glass"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-soft text-2xl text-rose">!</div><h2 className="mt-5 text-xl font-semibold text-text">没有管理员权限</h2><p className="mt-3 text-sm leading-6 text-textSub">签到记录属于管理数据。普通学习者仍可使用导入、学习、笔记和复习功能。</p><Link href="/dashboard" className="mt-6 inline-flex rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">返回工作台</Link></div></section> : <div className="space-y-6">
      <section className="rounded-lg border border-glass-line bg-surface p-6 shadow-glass"><span className="section-kicker">ADMIN · ATTENDANCE</span><h1 className="section-title mt-2">签到记录</h1><p className="section-description mt-2">{total === null ? (loading ? '正在读取记录数量…' : '记录数量暂不可用。') : `共 ${total} 条记录。`}仅展示最小化的账号标识、结果、验证/记录版本与签到时间。</p><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto]"><input aria-label="按用户ID筛选" value={userId} onChange={(event) => { setUserId(event.target.value); setPage(1); }} placeholder="按用户 ID 查询" className="rounded-md border border-glass-line bg-bg px-4 py-3 text-sm text-text outline-none focus:border-brand" /><select aria-label="筛选签到状态" value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }} className="rounded-md border border-glass-line bg-bg px-4 py-3 text-sm text-text outline-none focus:border-brand"><option value="">全部状态</option><option value="signed_in">人脸核验</option><option value="self_check_in">普通打卡</option><option value="manual_confirmation">历史待确认</option></select><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="开始日期" className="rounded-md border border-glass-line bg-bg px-4 py-3 text-sm text-text outline-none focus:border-brand" /><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="结束日期" className="rounded-md border border-glass-line bg-bg px-4 py-3 text-sm text-text outline-none focus:border-brand" /><button type="button" onClick={() => void load()} className="rounded-md border border-brand px-5 py-3 text-sm font-medium text-brand-ink">刷新</button></div></section>
      {error ? <p role="alert" className="rounded-md bg-rose-soft px-4 py-3 text-sm text-rose">{error}</p> : null}
      <section className="overflow-hidden rounded-lg border border-glass-line bg-surface shadow-glass"><div className="hidden grid-cols-[1.1fr_1.1fr_120px_180px_170px] gap-4 border-b border-glass-line px-5 py-4 text-xs text-textMute md:grid"><span>学习者</span><span>用户 ID</span><span>签到结果</span><span>验证/记录版本</span><span>签到时间</span></div>{loading ? <div className="p-12 text-center text-sm text-textSub">正在加载签到记录…</div> : total === null ? <div role="alert" className="p-12 text-center text-sm text-rose">签到记录读取失败，请刷新重试。</div> : items.length === 0 ? <div className="p-12 text-center text-sm text-textSub">没有符合当前筛选条件的签到记录。</div> : <div className="divide-y divide-glass-line">{items.map((item) => <article key={item.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1.1fr_1.1fr_120px_180px_170px] md:items-center md:gap-4"><p className="text-sm font-medium text-text">{item.nickname}</p><p className="truncate font-mono text-xs text-textSub">{item.userId}</p><span className={`w-fit rounded-full px-2.5 py-1 text-xs ${item.status === 'signed_in' ? 'bg-teal-soft text-teal' : 'bg-amber-soft text-amber'}`}>{item.status === 'signed_in' ? '人脸核验' : item.status === 'self_check_in' ? '普通打卡' : '历史待确认'}</span><p className="text-xs text-textSub">{item.verificationVersion}</p><p className="text-xs text-textMute">{formatDate(item.signedAt)}</p></article>)}</div>}</section>
      <div className="flex items-center justify-between text-sm text-textSub"><span>{total === null ? '页数待读取' : `第 ${page} / ${totalPages} 页`}</span><div className="flex gap-2"><button type="button" disabled={total === null || page <= 1 || loading} onClick={() => setPage((current) => current - 1)} className="rounded-md border border-glass-line px-3 py-2 disabled:opacity-40">上一页</button><button type="button" disabled={total === null || page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-md border border-glass-line px-3 py-2 disabled:opacity-40">下一页</button></div></div>
    </div>}
  </AdminShell>;
}

