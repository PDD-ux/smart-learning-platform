'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { attendanceApi, type DailyCheckIn } from '@/services/attendance';

export function DailyCheckInCard({ compact = false, settingsHref = '/attendance', showPlansLink = true }: { compact?: boolean; settingsHref?: string; showPlansLink?: boolean } = {}): ReactElement {
  const [daily, setDaily] = useState<DailyCheckIn | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try { setDaily(await attendanceApi.today()); setError(''); }
    catch (reason) { setDaily(null); setError(reason instanceof Error ? reason.message : '今日状态加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = (): void => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60_000);
    return (): void => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load]);
  const checkIn = async (): Promise<void> => {
    setBusy(true); setError('');
    try { setDaily(await attendanceApi.checkIn()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '打卡未完成，请重试'); }
    finally { setBusy(false); }
  };
  if (compact) return <section className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-glass-line bg-surface px-4 py-3" aria-labelledby="daily-check-in-title">
    <h2 id="daily-check-in-title" className="text-sm font-semibold">今日打卡</h2>
    <p role="status" className="min-w-0 text-sm text-textSub">{loading ? '正在读取今日状态…' : daily ? `${daily.date} · ${daily.checkedIn ? `${daily.method === 'face' ? '人脸核验' : '普通打卡'} · ${new Date(daily.signedAt ?? '').toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}` : '尚未打卡'}` : '今日状态未知'}</p>
    <button type="button" disabled={busy || loading || !daily || daily.checkedIn} onClick={() => void checkIn()} className="min-h-11 rounded-lg border border-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50">{busy ? '打卡中…' : daily?.checkedIn ? '今日已打卡' : '立即打卡'}</button>
    <Link href={settingsHref} className="inline-flex min-h-11 items-center text-sm text-brand-ink">打卡与人脸设置 →</Link>
    {error && <div className="flex w-full flex-wrap items-center gap-3"><p role="alert" className="text-sm text-rose">{error}</p><button type="button" disabled={loading || busy} onClick={() => void load()} className="min-h-11 text-sm text-brand-ink">重新读取状态</button></div>}
    <p className="w-full text-xs text-textMute">打卡仅记录今天已进入学习，不计学习时长或计划完成。</p>
  </section>;
  return <section className="dashboard-section" aria-labelledby="daily-check-in-title">
    <span className="section-kicker">DAILY CHECK-IN</span>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
      <div><h2 id="daily-check-in-title" className="section-title">今日学习打卡</h2>
        <p className="section-description mt-2">人脸登录会自动打卡；密码登录后，点击下方按钮完成普通打卡。每天只记一次，无需审批。</p></div>
      <button type="button" disabled={busy || loading || !daily || daily.checkedIn} onClick={() => void checkIn()} className="min-h-11 rounded-md bg-brand px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{loading ? '加载今日状态…' : busy ? '打卡中…' : daily?.checkedIn ? '今日已打卡' : '立即打卡'}</button>
    </div>
    {daily ? <p role="status" className="mt-4 text-sm text-textSub">{daily.date} · {daily.checkedIn ? `${daily.method === 'face' ? '人脸核验' : '普通打卡'} · ${new Date(daily.signedAt ?? '').toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}` : '今日尚未打卡'}</p> : null}
    {error ? <div className="mt-3"><p role="alert" className="text-sm text-rose">{error}</p><button type="button" disabled={loading || busy} onClick={() => void load()} className="mt-2 min-h-11 text-sm text-brand-ink">重新读取状态</button></div> : null}
    <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link href={settingsHref} className="inline-flex min-h-11 items-center font-medium text-brand-ink">人脸登录与模板设置 →</Link>{showPlansLink ? <Link href="/study-plans" className="inline-flex min-h-11 items-center text-textSub">查看学习待办 →</Link> : null}</div>
    <p className="mt-2 text-xs text-textMute">打卡表示今天已进入学习，不代表人脸核验（普通方式）、实际时长或计划已完成。</p>
  </section>;
}
