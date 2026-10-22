import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientError, type ContentList, type Profile } from '@/services/api';
const m = vi.hoisted(() => ({ messages: vi.fn(async () => { throw new Error("not released"); }), profile: vi.fn(), contents: vi.fn(), logout: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@/services/api', () => ({ ApiClientError: class extends Error { readonly status = 404; }, api: m, getAccessToken: (): string => 'unit-test', clearAccessToken: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: (): string => '/dashboard', useRouter: (): typeof router => router }));
import { AppShell } from '@/components/app/AppShell';
beforeEach((): void => { vi.resetAllMocks(); m.messages.mockRejectedValue(new ApiClientError('关闭',404,'NOT_FOUND')); m.profile.mockResolvedValue({ nickname: '初始学员', xpTotal: 0, currentLevel: 'Lv.1 · 新手', role: 'student' }); m.contents.mockResolvedValue({ items: [] }); });
afterEach(cleanup);
it('keeps the initial role check explicit and exposes search after the account loads', async (): Promise<void> => {
  let profile!: (value: Profile) => void; let contents!: (value: ContentList) => void;
  m.profile.mockReturnValue(new Promise<Profile>((resolve) => { profile = resolve; })); m.contents.mockReturnValue(new Promise<ContentList>((resolve) => { contents = resolve; }));
  render(<AppShell title="test">内容</AppShell>);
  expect(screen.getByText('正在载入学习空间…')).toBeTruthy(); expect(screen.queryByText('0 XP')).toBeNull(); expect(screen.queryByText('Lv.1 · 新手')).toBeNull();
  await act(async (): Promise<void> => { profile({ nickname: '学生', role: 'student', xpTotal: 0, currentLevel: 'Lv.1 · 新手', achievements: [] }); });
  fireEvent.click(screen.getByRole('button', { name: '打开内容搜索' }));
  expect(screen.getByText('正在读取搜索资料…')).toBeTruthy(); expect(screen.queryByText('还没有找到相关内容')).toBeNull();
  await act(async (): Promise<void> => { contents({ page: 1, pageSize: 50, total: 0, items: [] }); });
  expect(screen.getByText('学生')).toBeTruthy(); expect(screen.getByText('还没有找到相关内容')).toBeTruthy();
});
it('retries account and search independently and retains the search draft', async (): Promise<void> => {
  m.profile.mockRejectedValueOnce(new Error('失败')); m.contents.mockRejectedValueOnce(new Error('失败'));
  render(<AppShell title="test">内容</AppShell>); await screen.findByRole('button', { name: '重试账号信息' });
  fireEvent.click(screen.getByRole('button', { name: '打开内容搜索' })); fireEvent.change(screen.getByPlaceholderText('输入标题或关键词…'), { target: { value: '课程' } });
  fireEvent.click(await screen.findByRole('button', { name: '重试搜索资料' })); await screen.findByText('还没有找到相关内容'); expect(m.profile).toHaveBeenCalledTimes(1);
  expect((screen.getByPlaceholderText('输入标题或关键词…') as HTMLInputElement).value).toBe('课程');
  fireEvent.click(screen.getByRole('button', { name: '重试账号信息' })); await screen.findByText('初始学员'); expect(m.contents).toHaveBeenCalledTimes(2);
});
it('keeps the public preview explicit and avoids authenticated data reads', async (): Promise<void> => {
  render(<AppShell title="preview" preview>示例</AppShell>); expect(screen.getByText('免登录示例')).toBeTruthy(); expect(screen.queryByText('1280 XP')).toBeNull(); expect(m.profile).not.toHaveBeenCalled(); expect(m.contents).not.toHaveBeenCalled();
});

it('refreshes account identity after a confirmed review without restoring XP or losing page inputs', async (): Promise<void> => {
  const { notifyProfileUpdated } = await import('@/services/profile-updates');
  let finish!: (value: Profile) => void;
  render(<AppShell title="test"><input aria-label="草稿" defaultValue="保留我的输入" /></AppShell>);
  await screen.findByText('初始学员');
  m.profile.mockReturnValueOnce(new Promise<Profile>((resolve) => { finish = resolve; }));
  act((): void => notifyProfileUpdated());
  expect(screen.queryByText('0 XP')).toBeNull();
  expect(screen.getByLabelText('当前身份：学习者')).toBeTruthy();
  await act(async (): Promise<void> => { finish({ nickname: '学生', role: 'student', xpTotal: 17, currentLevel: 'Lv.2', achievements: [] }); });
  expect(screen.getByText('学生')).toBeTruthy();
  expect(document.querySelector('.sidebar-xp')).toBeNull();
  expect(screen.queryByText('Lv.2')).toBeNull();
  expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('保留我的输入');
  expect(m.profile).toHaveBeenCalledTimes(2);
});

it('ignores the late initial profile response and releases its subscription', async (): Promise<void> => {
  const { notifyProfileUpdated } = await import('@/services/profile-updates');
  let old!: (value: Profile) => void;
  m.profile.mockReturnValueOnce(new Promise<Profile>((resolve) => { old = resolve; }));
  const view = render(<AppShell title="test">内容</AppShell>);
  m.profile.mockResolvedValueOnce({ nickname: '更新学员', xpTotal: 17, currentLevel: 'Lv.2', role: 'student' });
  act((): void => notifyProfileUpdated());
  await screen.findByText('更新学员');
  await act(async (): Promise<void> => { old({ nickname:'学生',role:'student',xpTotal:0,currentLevel:'Lv.1',achievements:[] }); });
  expect(screen.getByText('更新学员')).toBeTruthy();
  view.unmount(); act((): void => notifyProfileUpdated());
  expect(m.profile).toHaveBeenCalledTimes(2);
});

it('keeps refreshed account failure explicit and permits independent retry', async (): Promise<void> => {
  const { notifyProfileUpdated } = await import('@/services/profile-updates');
  render(<AppShell title="test">内容</AppShell>); await screen.findByText('初始学员');
  m.profile.mockRejectedValueOnce(new Error('读取失败'));
  act((): void => notifyProfileUpdated());
  fireEvent.click(await screen.findByRole('button', { name:'重试账号信息' }));
  await screen.findByText('初始学员');
  expect(m.profile).toHaveBeenCalledTimes(3); expect(m.logout).not.toHaveBeenCalled();
});

it('does not refresh authenticated profiles in preview mode', async (): Promise<void> => {
  const { notifyProfileUpdated } = await import('@/services/profile-updates');
  render(<AppShell title="preview" preview>示例</AppShell>);
  act((): void => notifyProfileUpdated());
  expect(screen.queryByText('1280 XP')).toBeNull(); expect(m.profile).not.toHaveBeenCalled();
});

it('groups usable learner routes and exposes help and check-in without upcoming features', async (): Promise<void> => {
  render(<AppShell title="test">内容</AppShell>);
  await screen.findByText('初始学员');
  const nav = screen.getByRole('navigation', { name: '学习功能' });
  expect(within(nav).getAllByRole('link').map((link): string | null => link.getAttribute('aria-label'))).toEqual(['工作台', '学习中心', '班级课程', '智能批改']);
  expect(screen.getByRole('navigation', { name: '工作台功能' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '使用指南' }).getAttribute('href')).toBe('/help');
  expect(screen.getByRole('link', { name: '打卡与人脸设置' }).getAttribute('href')).toBe('/attendance');
  expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: '平台管理' })).toBeNull();
  expect(document.querySelector('a[href="/study-plans"]')).toBeTruthy();
  expect(document.querySelector('a[href="/messages"], a[href^="/courses"]')).toBeNull();
});
