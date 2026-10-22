import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminOverview: vi.fn(),
  profile: vi.fn(),
  getAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
  logout: vi.fn(),
  router: { replace: vi.fn() },
  pathname: '/admin',
}));

type TestLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };

vi.mock('next/link', () => ({
  default: function TestLink({ children, ...props }: TestLinkProps): ReturnType<typeof createElement> {
    return createElement('a', props, children);
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
}));

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    api: { ...actual.api, adminOverview: mocks.adminOverview, profile: mocks.profile, logout: mocks.logout },
    getAccessToken: mocks.getAccessToken,
    clearAccessToken: mocks.clearAccessToken,
  };
});

import AdminOverviewPage from '@/app/admin/page';
import { AdminShell } from '@/components/admin/AdminShell';

const overview = {
  date: '2026-10-09',
  generatedAt: '2026-10-09T03:00:00.000Z',
  users: {
    total: 12,
    students: 10,
    admins: 2,
    recent: [{ id: 'student-1', nickname: '小明', role: 'student' as const, createdAt: '2026-10-09T01:00:00.000Z' }],
  },
  attendance: { total: 5, signedIn: 4, manualConfirmation: 1 },
};

function useAdminSession(): void {
  mocks.getAccessToken.mockReturnValue('session-token');
  mocks.profile.mockResolvedValue({ nickname: '平台管理员', role: 'admin', xpTotal: 0, currentLevel: '初学者', achievements: [] });
}

describe('administrator management center pages', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
    });
    mocks.pathname = '/admin';
    mocks.router.replace = vi.fn();
    useAdminSession();
    mocks.adminOverview.mockResolvedValue(overview);
  });

  afterEach(() => cleanup());

  it('shows live overview totals, recent accounts, administrator navigation, and current nickname', async () => {
    render(createElement(AdminOverviewPage));
    expect(await screen.findByRole('heading', { name: '平台管理中心' })).toBeTruthy();
    expect(await screen.findByText('小明')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('4 次')).toBeTruthy();
    expect(screen.getAllByText('平台管理员').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('navigation', { name: '管理员导航' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull();
  });

  it('shows an explicit empty state when there are no accounts or attendance records', async () => {
    mocks.adminOverview.mockResolvedValue({ ...overview, users: { ...overview.users, total: 0, students: 0, admins: 0, recent: [] }, attendance: { total: 0, signedIn: 0, manualConfirmation: 0 } });
    render(createElement(AdminOverviewPage));
    expect(await screen.findByText('还没有账号记录')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('offers retry after the initial overview load fails', async () => {
    mocks.adminOverview.mockRejectedValueOnce(new Error('暂时不可用')).mockResolvedValueOnce(overview);
    render(createElement(AdminOverviewPage));
    expect(await screen.findByText('概况暂时无法加载')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(mocks.adminOverview).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('小明')).toBeTruthy();
  });

  it('refreshes overview and disables repeat requests while the refresh is pending', async () => {
    const deferred: { resolve?: (value: typeof overview) => void } = {};
    mocks.adminOverview.mockResolvedValueOnce(overview).mockImplementationOnce(
      () => new Promise<typeof overview>((resolve) => { deferred.resolve = resolve; }),
    );

    render(createElement(AdminOverviewPage));
    fireEvent.click(await screen.findByRole('button', { name: '刷新概况' }));
    const pendingButton = screen.getByRole('button', { name: '刷新中…' });
    expect(pendingButton.hasAttribute('disabled')).toBe(true);
    expect(pendingButton.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(pendingButton);
    expect(mocks.adminOverview).toHaveBeenCalledTimes(2);

    deferred.resolve?.({ ...overview, users: { ...overview.users, students: 11 } });
    await waitFor(() => expect(screen.getByText('11')).toBeTruthy());
  });

  it('keeps the last successful overview after refresh failure and allows retry', async () => {
    const updatedOverview = { ...overview, users: { ...overview.users, students: 11 } };
    mocks.adminOverview.mockResolvedValueOnce(overview).mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce(updatedOverview);

    render(createElement(AdminOverviewPage));
    fireEvent.click(await screen.findByRole('button', { name: '刷新概况' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/仍显示上次成功加载的数据/)).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(screen.getByText('11')).toBeTruthy());
    expect(mocks.adminOverview).toHaveBeenCalledTimes(3);
  });

  it('does not render management navigation or children for a learner', async () => {
    mocks.profile.mockResolvedValue({ nickname: '小明', role: 'student', xpTotal: 0, currentLevel: '初学者', achievements: [] });
    render(createElement(AdminShell, null, createElement('p', null, '管理数据')));
    expect(await screen.findByText('没有管理员权限')).toBeTruthy();
    expect(screen.queryByText('管理数据')).toBeNull();
    expect(screen.queryByRole('navigation', { name: '管理员导航' })).toBeNull();
    expect(screen.getByRole('link', { name: '返回学习工作台' }).getAttribute('href')).toBe('/dashboard');
  });
});