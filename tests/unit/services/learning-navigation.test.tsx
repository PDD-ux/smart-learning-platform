import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LearningNavigation, primaryNavigationActive } from '@/components/app/LearningNavigation';

afterEach(cleanup);

it('keeps old practice routes reachable with one selected parent and the correct child', (): void => {
  render(<LearningNavigation pathname="/review" />);
  const parent = screen.getByRole('navigation', { name: '学习中心功能' });
  const child = screen.getByRole('navigation', { name: '练习与复习功能' });
  expect(parent.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(within(parent).getByRole('link', { name: '练习与复习' }).getAttribute('aria-current')).toBe('page');
  expect(child.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(within(child).getByRole('link', { name: '复习巩固' }).getAttribute('href')).toBe('/review');
  expect(within(child).getByRole('link', { name: '复习巩固' }).getAttribute('aria-current')).toBe('page');
  expect(within(child).getByRole('link', { name: '知识图谱' }).getAttribute('href')).toBe('/graph');
});

it('puts the existing plans URL under the workspace without exposing learning tools', (): void => {
  render(<LearningNavigation pathname="/study-plans" />);
  const nav = screen.getByRole('navigation', { name: '工作台功能' });
  expect(within(nav).getByRole('link', { name: '学习计划' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('navigation', { name: '学习中心功能' })).toBeNull();
  expect(primaryNavigationActive('/dashboard', '/study-plans')).toBe(true);
  expect(primaryNavigationActive('/import', '/study-plans')).toBe(false);
});

it('keeps study and shared-course links in learning without matching unrelated prefixes', (): void => {
  for (const path of ['/study/owned-content', '/courses/shared-course', '/notes', '/assistant', '/graph']) {
    expect(primaryNavigationActive('/import', path)).toBe(true);
  }
  for (const path of ['/study-plans', '/courses-unknown', '/admin/courses', '/exams']) {
    expect(primaryNavigationActive('/import', path)).toBe(false);
  }
  render(<LearningNavigation pathname="/study/owned-content" />);
  expect(screen.getByRole('link', { name: '学习资料' }).getAttribute('aria-current')).toBe('page');
});

it('does not add personal tools to face settings, shared-only reading or old exam pages', (): void => {
  for (const pathname of ['/attendance', '/courses/shared-course', '/admin', '/exams', '/unknown']) {
    const { unmount, container } = render(<LearningNavigation pathname={pathname} />);
    expect(container.querySelector('nav')).toBeNull();
    unmount();
  }
});

it('does not show workspace tools in a public preview or unavailable core modules', (): void => {
  const { container } = render(<LearningNavigation pathname="/import" preview />);
  expect(container.querySelector('a')).toBeNull();
  cleanup();
  render(<LearningNavigation pathname="/import" />);
  expect(screen.queryByRole('link', { name: /班级|批改|链接导入|EPUB|讲解|答辩|试卷/u })).toBeNull();
});

it('selects class navigation without treating it as private learning material', (): void => {
  expect(primaryNavigationActive('/classes', '/classes')).toBe(true);
  expect(primaryNavigationActive('/classes', '/classes/example')).toBe(true);
  expect(primaryNavigationActive('/import', '/classes/example')).toBe(false);
  expect(primaryNavigationActive('/classes', '/classes-unknown')).toBe(false);
});
