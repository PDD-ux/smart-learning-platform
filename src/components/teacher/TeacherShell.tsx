'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { api, ApiClientError, clearAccessToken, getAccessToken, type Profile } from '@/services/api';

const teacherNavigation = [
  { href: '/teacher', label: '教学总览', icon: '⌂' },
  { href: '/teacher/classes', label: '我的课程', icon: '▤' },
  { href: '/teacher/assignments', label: '作业批阅', icon: '✓' },
  { href: '/teacher/courses', label: '课程资料', icon: '▦' },
  { href: '/teacher/attendance', label: '打卡与人脸', icon: '◉' },
] as const;

type TeacherShellProps = { children: ReactNode };
type ShellState = 'checking' | 'ready' | 'forbidden' | 'error';

function pageTitle(pathname: string): string {
  if (pathname.includes('/assignments/') || pathname.includes('/submissions/')) return '作业批阅';
  if (pathname === '/teacher/classes' || pathname.startsWith('/teacher/classes/')) return '我的课程';
  if (pathname === '/teacher/assignments') return '作业批阅';
  if (pathname === '/teacher/courses') return '课程资料';
  if (pathname === '/teacher/attendance') return '打卡与人脸';
  return '教学总览';
}

export function TeacherShell({ children }: TeacherShellProps): ReactElement {
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
      setShellState(currentProfile.role === 'teacher' ? 'ready' : 'forbidden');
    }).catch((reason: unknown) => {
      if (!active) return;
      if (reason instanceof ApiClientError && reason.status === 401) {
        clearAccessToken();
        router.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : '教师身份校验失败，请重试。');
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
    return <div className="app-loading" role="status"><span className="loading-orbit" />正在验证教师身份…</div>;
  }

  if (shellState === 'error') {
    return <main className="app-canvas flex min-h-screen items-center justify-center p-6"><section className="w-full max-w-lg rounded-lg border border-glass-line bg-surface p-8 text-center shadow-glass"><p className="section-kicker">TEACHER · ACCESS</p><h1 className="mt-2 text-xl font-semibold text-text">教师身份暂时无法确认</h1><p role="alert" className="mt-3 text-sm text-textSub">{error}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-6 rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">重试</button></section></main>;
  }

  if (shellState === 'forbidden') {
    return <main className="app-canvas flex min-h-screen items-center justify-center p-6"><section className="w-full max-w-lg rounded-lg border border-glass-line bg-surface p-8 text-center shadow-glass"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-soft text-2xl text-rose">!</div><h1 className="mt-5 text-xl font-semibold text-text">没有教师权限</h1><p className="mt-3 text-sm leading-6 text-textSub">教学工作区只对教师账号开放。学生可返回学习工作台；管理员请返回平台管理中心。</p><Link href={profile?.role === 'admin' ? '/admin' : '/dashboard'} className="mt-6 inline-flex min-h-11 items-center rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">返回{profile?.role === 'admin' ? '管理中心' : '学习工作台'}</Link></section></main>;
  }

  const currentTitle = pageTitle(pathname);

  return <div className="app-canvas admin-canvas min-h-screen">
    <div className="ambient ambient-one" aria-hidden="true" />
    <div className="ambient ambient-two" aria-hidden="true" />
    <aside className="app-sidebar admin-sidebar teacher-sidebar">
      <Link href="/teacher" className="brand-lockup"><span className="brand-mark">知</span><span><strong>文豪</strong><small>教师工作台</small></span></Link>
      <div className="sidebar-section-label">教学工作区</div>
      <nav className="sidebar-nav" aria-label="教师导航">
        {teacherNavigation.map((item) => {
          const active = pathname === item.href || (item.href === '/teacher/classes' && pathname.startsWith('/teacher/classes/')) || (item.href === '/teacher/assignments' && (pathname.includes('/assignments/') || pathname.includes('/submissions/')));
          return <Link key={item.href} href={item.href} className={`sidebar-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{active ? <span className="sidebar-nav-dot" aria-hidden="true" /> : null}
          </Link>;
        })}
      </nav>
      <div className="sidebar-insight admin-sidebar-insight"><div className="insight-orb"><span>✓</span></div><div><strong>仅管理本人班级</strong><span><i /> 作业草稿对负责人隐藏</span></div></div>
      <div className="sidebar-user admin-sidebar-user"><div className="user-avatar">{profile?.nickname.trim().slice(0, 1) || '师'}</div><div className="min-w-0"><strong>{profile?.nickname ?? '教师账号'}</strong><span>教师</span></div></div>
    </aside>
    <div className="app-main admin-main">
      <header className="app-topbar admin-topbar"><div className="topbar-inner admin-topbar-inner"><div><p className="text-xs text-textMute">教师工作区 / {currentTitle}</p><h1 className="mt-1 text-lg font-semibold text-text">{currentTitle}</h1></div><div className="topbar-actions"><Link href="/help" className="learner-topbar-link">使用指南</Link><span className="topbar-profile"><span className="user-avatar small">师</span><span>{profile?.nickname ?? '教师'}</span></span><button type="button" onClick={() => void logout()} className="topbar-logout">退出登录</button></div></div></header>
      <main className="app-content admin-content">{children}</main>
    </div>
  </div>;
}
