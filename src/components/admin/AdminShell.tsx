'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { api, ApiClientError, clearAccessToken, getAccessToken, type Profile } from '@/services/api';

const adminNavigation = [
  { href: '/admin', label: '管理总览', icon: '⌂' },
  { href: '/admin/users', label: '用户管理', icon: '♙' },
  { href: '/admin/attendance', label: '签到记录', icon: '▤' },
  { href: '/admin/classes', label: '旧班级兼容入口', icon: '▤' },
  { href: '/admin/discussions', label: '讨论与举报', icon: '☷' },
] as const;

type AdminShellProps = { children: ReactNode };
type ShellState = 'checking' | 'ready' | 'forbidden' | 'error';

function pageTitle(pathname: string): string {
  if (pathname === '/admin/classes' || pathname.startsWith('/admin/classes/')) return '旧班级兼容入口';
  if (pathname === '/admin/discussions') return '讨论与举报';
  if (pathname === '/admin/courses') return '共享课程治理';
  if (pathname === '/admin/users') return '用户管理';
  if (pathname === '/admin/attendance') return '签到记录';
  return '管理总览';
}

export function AdminShell({ children }: AdminShellProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shellState, setShellState] = useState<ShellState>('checking');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }

    let active = true;
    setShellState('checking');
    setError('');
    void api.profile().then((currentProfile) => {
      if (!active) return;
      setProfile(currentProfile);
      setShellState(currentProfile.role === 'admin' ? 'ready' : 'forbidden');
    }).catch((reason: unknown) => {
      if (!active) return;
      if (reason instanceof ApiClientError && reason.status === 401) {
        clearAccessToken();
        router.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : '管理员身份校验失败，请重试。');
      setShellState('error');
    });

    return () => { active = false; };
  }, [retryKey, router]);

  const logout = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    clearAccessToken();
    router.replace('/login');
  };

  if (shellState === 'checking') {
    return <div className="app-loading" role="status"><span className="loading-orbit" />正在验证管理员身份…</div>;
  }

  if (shellState === 'error') {
    return <main className="app-canvas flex min-h-screen items-center justify-center p-6"><section className="w-full max-w-lg rounded-lg border border-glass-line bg-surface p-8 text-center shadow-glass"><p className="section-kicker">ADMIN · ACCESS</p><h1 className="mt-2 text-xl font-semibold text-text">管理员身份暂时无法确认</h1><p role="alert" className="mt-3 text-sm text-textSub">{error}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-6 rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">重试</button></section></main>;
  }

  if (shellState === 'forbidden') {
    const destination = profile?.role === 'teacher' ? '/teacher' : '/dashboard';
    const label = profile?.role === 'teacher' ? '教师工作台' : '学习工作台';
    return <main className="app-canvas flex min-h-screen items-center justify-center p-6"><section className="w-full max-w-lg rounded-lg border border-glass-line bg-surface p-8 text-center shadow-glass"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-soft text-2xl text-rose">!</div><h1 className="mt-5 text-xl font-semibold text-text">没有管理员权限</h1><p className="mt-3 text-sm leading-6 text-textSub">平台管理工作区只对管理员账号开放。</p><Link href={destination} className="mt-6 inline-flex min-h-11 items-center rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">返回{label}</Link></section></main>;
  }

  const currentTitle = pageTitle(pathname);

  return <div className="app-canvas admin-canvas min-h-screen">
    <div className="ambient ambient-one" aria-hidden="true" />
    <div className="ambient ambient-two" aria-hidden="true" />
    <aside className="app-sidebar admin-sidebar">
      <Link href="/admin" className="brand-lockup"><span className="brand-mark">知</span><span><strong>文豪</strong><small>平台管理中心</small></span></Link>
      <div className="sidebar-section-label">管理员工作区</div>
      <nav className="sidebar-nav" aria-label="管理员导航">
        {adminNavigation.map((item) => {
          const active = pathname === item.href || (item.href === '/admin/classes' && pathname.startsWith('/admin/classes/'));
          return <Link key={item.href} href={item.href} className={`sidebar-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{active ? <span className="sidebar-nav-dot" aria-hidden="true" /> : null}
          </Link>;
        })}
      </nav>
      <div className="sidebar-insight admin-sidebar-insight"><div className="insight-orb"><span>✓</span></div><div><strong>管理范围清晰</strong><span><i /> 仅展示管理所需摘要</span></div></div>
      <div className="sidebar-user admin-sidebar-user"><div className="user-avatar">{profile?.nickname.trim().slice(0, 1) || '管'}</div><div className="min-w-0"><strong>{profile?.nickname ?? '管理员账号'}</strong><span>{profile?.role === 'admin' ? '平台管理权限' : '管理中心'}</span></div></div>
    </aside>
    <div className="app-main admin-main">
      <header className="app-topbar admin-topbar"><div className="topbar-inner admin-topbar-inner"><div><p className="text-xs text-textMute">平台管理 / {currentTitle}</p><h1 className="mt-1 text-lg font-semibold text-text">{currentTitle}</h1></div><div className="topbar-actions"><span className="topbar-profile"><span className="user-avatar small">{profile?.nickname.trim().slice(0, 1) || '管'}</span><span>{profile?.nickname ?? '管理员'}</span></span><button type="button" onClick={() => void logout()} className="topbar-logout">退出登录</button></div></div></header>
      <main className="app-content admin-content">{children}</main>
    </div>
  </div>;
}
