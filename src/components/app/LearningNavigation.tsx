import Link from 'next/link';
import type { ReactElement } from 'react';

export const primaryNavigation = [
  { href: '/dashboard', label: '工作台', icon: '⌂' },
  { href: '/import', label: '学习中心', icon: '◉' },
  { href: '/classes', label: '班级课程', icon: '▦' },
  { href: '/homework', label: '智能批改', icon: '✎' },
] as const;

const practicePaths = ['/question-bank', '/review', '/graph'];
const learningPaths = ['/import', '/notes', '/assistant', '/topics', ...practicePaths];

export function primaryNavigationActive(href: string, pathname: string): boolean {
  if (href === '/homework') return pathname === '/homework' || pathname.startsWith('/homework/');
  if (href === '/classes') return pathname === '/classes' || pathname.startsWith('/classes/');
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard-preview' || pathname === '/study-plans';
  return href === '/import' && (learningPaths.includes(pathname) || pathname.startsWith('/study/') || pathname.startsWith('/courses/'));
}

export function LearningNavigation({ pathname, preview = false }: { pathname: string; preview?: boolean }): ReactElement | null {
  if (preview) return null;
  const isWorkspace = pathname === '/dashboard' || pathname === '/study-plans';
  const isLearning = learningPaths.includes(pathname) || pathname.startsWith('/study/');
  if (!isWorkspace && !isLearning) return null;
  const practice = practicePaths.includes(pathname);
  const links = isWorkspace ? [
    { href: '/dashboard', label: '我的学习', active: pathname === '/dashboard' },
    { href: '/study-plans', label: '学习计划', active: pathname === '/study-plans' },
  ] : [
    { href: '/import', label: '学习资料', active: pathname === '/import' || pathname.startsWith('/study/') },
    { href: '/notes', label: '我的笔记', active: pathname === '/notes' },
    { href: '/assistant', label: 'AI 学习助手', active: pathname === '/assistant' },
    { href: '/topics', label: '专题学习', active: pathname === '/topics' },
    { href: '/question-bank', label: '练习与复习', active: practice },
  ];
  return <div className="learning-workspace-nav">
    <nav aria-label={isWorkspace ? '工作台功能' : '学习中心功能'}>{links.map((link): ReactElement =>
      <Link key={link.href} href={link.href} aria-current={link.active ? 'page' : undefined}>{link.label}</Link>,
    )}</nav>
    {practice && <nav className="learning-workspace-subnav" aria-label="练习与复习功能">{[
      { href: '/question-bank', label: '练习题库' },
      { href: '/review', label: '复习巩固' },
      { href: '/graph', label: '知识图谱' },
    ].map((link): ReactElement => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>{link.label}</Link>)}</nav>}
  </div>;
}
