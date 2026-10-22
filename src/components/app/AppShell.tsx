'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { api, clearAccessToken, getAccessToken, type ContentSummary, type Profile } from '@/services/api';

import { subscribeProfileUpdates } from '@/services/profile-updates';
import { MessageLink } from '@/components/courses/MessageLink';
import { LearningNavigation, primaryNavigation, primaryNavigationActive } from '@/components/app/LearningNavigation';

type AppShellProps = { children: ReactNode; title: string; subtitle?: string; preview?: boolean; compactNavigation?: boolean };

function NavItem({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }): ReactElement {
  return <Link href={href} aria-label={label} title={label} aria-current={active ? 'page' : undefined} className={`sidebar-nav-item ${active ? 'is-active' : ''}`}><span className="sidebar-nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>{active ? <span className="sidebar-nav-dot" aria-hidden="true" /> : null}</Link>;
}

const previewSearchItems: ContentSummary[] = [
  { contentId: 'preview-1', contentType: 'video', title: '深度学习视觉理解：从图像到知识', description: '从图像理解到知识点整理', durationSec: 2460, pageCount: null, status: '已就绪', coverUrl: null, understandingStatus: 'completed', createdAt: '2026-09-16T09:00:00.000Z', updatedAt: '2026-09-16T09:30:00.000Z' },
  { contentId: 'preview-2', contentType: 'document', title: '教育心理学 · 认知负荷理论讲义', description: '理解注意力、工作记忆与学习效果', durationSec: null, pageCount: 28, status: '已就绪', coverUrl: null, understandingStatus: 'completed', createdAt: '2026-09-15T12:00:00.000Z', updatedAt: '2026-09-15T12:30:00.000Z' },
  { contentId: 'preview-3', contentType: 'video', title: '高效复习系统：如何建立长期记忆', description: '把短期记忆变成稳定掌握', durationSec: 1320, pageCount: null, status: '解析中', coverUrl: null, understandingStatus: 'running', createdAt: '2026-09-14T16:00:00.000Z', updatedAt: '2026-09-14T16:10:00.000Z' },
];

function TopbarSearch({ preview }: { preview: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ContentSummary[]>(preview ? previewSearchItems : []);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preview) return;
    let active = true; setLoading(true); setError('');
    void api.contents().then((result) => { if (active) setItems(result.items); }).catch(() => { if (active) setError('搜索资料读取失败'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [preview, revision]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = items.filter((item) => !normalizedQuery || `${item.title} ${item.description ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 5);

  return <div className="topbar-search-wrap"><button type="button" className="topbar-search" aria-label="打开内容搜索" aria-expanded={open} onClick={() => { setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }}><span aria-hidden="true">⌕</span><span>搜索我的学习资料…</span><kbd>Ctrl K</kbd></button>{open ? <div className="search-popover"><div className="search-popover-head"><strong>找一找</strong><button type="button" aria-label="关闭搜索" onClick={() => setOpen(false)}>×</button></div><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} className="search-popover-input" placeholder="输入标题或关键词…" />{loading ? <p role="status" className="p-4 text-sm text-textSub">正在读取搜索资料…</p> : error ? <div role="alert" className="p-4 text-sm text-rose"><p>{error}</p><button type="button" className="min-h-11 text-brand-ink" onClick={() => setRevision((value) => value + 1)}>重试搜索资料</button></div> : results.length > 0 ? <div className="search-results">{results.map((item) => <Link key={item.contentId} href={preview ? '/dashboard-preview#content-list' : `/study/${item.contentId}`} onClick={() => setOpen(false)} className="search-result"><span className={`search-result-icon ${item.contentType === 'video' ? 'is-video' : 'is-document'}`}>{item.contentType === 'video' ? '▶' : '▤'}</span><span><strong>{item.title}</strong><small>{item.description ?? (item.contentType === 'video' ? '视频内容' : '图文内容')}</small></span><i>↗</i></Link>)}</div> : <div className="search-empty"><span>⌁</span><p>还没有找到相关内容</p><small>试试换个关键词，或者先导入一份资料。</small></div>}</div> : null}</div>;
}

export function AppShell({ children, title, subtitle, preview = false, compactNavigation = false }: AppShellProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [profileRevision, setProfileRevision] = useState(0);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (preview) return;
    return subscribeProfileUpdates((): void => {
      setProfileLoading(true);
      setProfileRevision((value): number => value + 1);
    });
  }, [preview]);

  useEffect(() => {
    if (preview) {
      setProfile({ nickname: '示例学习者', role: 'student', xpTotal: 1280, currentLevel: 'Lv.8 · 稳定成长', achievements: [] });
      setChecking(false); setProfileLoading(false);
      return;
    }
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    let active = true; setProfileLoading(true); setProfileError('');
    void api.profile().then((result) => {
      if (!active) return;
      if (result.role !== 'student') {
        router.replace(result.role === 'teacher' ? '/teacher' : '/admin');
        return;
      }
      setProfile(result);
      setProfileLoading(false);
      setChecking(false);
    }).catch(() => { if (active) { setProfileError('账号信息读取失败'); setProfileLoading(false); setChecking(false); } });
    return () => { active = false; };
  }, [preview, router, profileRevision]);

  const logout = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    clearAccessToken();
    router.replace('/login');
  };

  const navHref = (href: string): string => {
    if (!preview) return href;
    return href === '/dashboard' ? '/dashboard-preview' : '/register';
  };

  const accountMark = profile?.role === 'admin' ? '管' : profile?.role === 'teacher' ? '师' : profile?.role === 'student' ? '学' : '知';
  const accountLabel = profile?.role === 'admin' ? '管理员' : profile?.role === 'teacher' ? '教师' : profile?.role === 'student' ? '学习者' : '账号';
  const accountTitle = profile?.nickname?.trim() || (profile?.role === 'admin' ? '管理员账号' : '我的账号');

  if (checking) return <div className="app-loading"><span className="loading-orbit" />正在载入学习空间…</div>;

  return <div className={`app-canvas min-h-screen${compactNavigation ? ' app-canvas-compact' : ''}`}>
    <div className="ambient ambient-one" aria-hidden="true" />
    <div className="ambient ambient-two" aria-hidden="true" />
    <aside className="app-sidebar">
      <Link href={navHref('/dashboard')} aria-label="文豪学习平台" className="brand-lockup"><span className="brand-mark">知</span><span><strong>文豪</strong><small>学习小宇宙</small></span></Link>
      <div className="sidebar-section-label">{preview ? '示例学习桌' : profile?.role === 'admin' ? '管理空间' : '我的学习桌'}</div>
      <nav className="sidebar-nav learner-navigation" aria-label="学习功能">{primaryNavigation.map((item): ReactElement => <NavItem key={item.href} {...item} href={navHref(item.href)} active={primaryNavigationActive(item.href, pathname)} />)}</nav>
      {profile?.role === 'admin' ? <>
        <div className="sidebar-section-label sidebar-admin-section-label">平台管理</div>
        <nav className="sidebar-nav" aria-label="平台管理"><NavItem href="/admin" label="管理中心" icon="♙" active={false} /></nav>
      </> : null}
      {preview ? <div className="sidebar-preview-note">免登录体验<br /><span>注册后解锁全部页面</span></div> : null}
      <div className="sidebar-insight"><div className="insight-orb"><span>✎</span></div><div><strong>我的学习空间</strong><span>资料、笔记与原文问答</span></div></div>
      {profileError && <div role="alert" className="px-3 text-sm text-rose">{profileError}<button type="button" className="min-h-11 text-brand-ink" onClick={() => setProfileRevision((value) => value + 1)}>重试账号信息</button></div>}
      <div className="sidebar-user"><div className="user-avatar">{accountMark}</div><div className="min-w-0"><strong>{accountTitle}</strong><span>{profileLoading ? '正在读取…' : profileError ? '暂不可用' : accountLabel}</span></div></div>
    </aside>
    <div className="app-main">
      <header className="app-topbar"><div className="topbar-inner"><div className="mobile-brand"><span className="brand-mark">知</span><strong>文豪</strong></div><TopbarSearch preview={preview} />{preview ? <span className="preview-chip">免登录示例</span> : null}<div className="topbar-actions learner-topbar-actions">{!preview && <><MessageLink /><Link href="/help" className="learner-topbar-link" aria-current={pathname === '/help' ? 'page' : undefined}>使用指南</Link><Link href="/attendance" className="learner-topbar-link" aria-label="打卡与人脸设置" aria-current={pathname === '/attendance' ? 'page' : undefined}>打卡设置</Link></>}<span className="topbar-divider" aria-hidden="true" /><div className="topbar-profile" aria-label={`当前身份：${accountLabel}`}><span className="user-avatar small">{accountMark}</span><span className="hidden xl:block">{accountLabel}</span></div><button type="button" onClick={() => void logout()} className="topbar-logout" aria-label="退出登录">退出</button></div></div></header>
      <main className="app-content"><LearningNavigation pathname={pathname} preview={preview} />{children}</main>
    </div>
  </div>;
}
