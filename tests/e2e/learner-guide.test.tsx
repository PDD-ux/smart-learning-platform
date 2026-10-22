import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ messages: vi.fn() }));
vi.mock('@/services/api', async (original) => { const actual = await original<typeof import('@/services/api')>(); return { ...actual, api: service }; });
import { ApiClientError } from '@/services/api';
import type { ReactElement, ReactNode } from 'react';
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactElement => <main>{children}</main> }));
import { LearningGuide } from '@/components/app/LearningGuide';
import Help from '@/app/help/page';

beforeEach((): void => { vi.clearAllMocks(); service.messages.mockRejectedValue(new ApiClientError('关闭',404,'NOT_FOUND')); });
afterEach(cleanup);

it('lets a returning learner open, dismiss and reopen steps without losing a sibling draft', (): void => {
  render(<><LearningGuide /><input aria-label="学习草稿" defaultValue="保留输入" /></>);
  expect(screen.queryByRole('list')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开新手指引' }));
  expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '收起新手指引' }));
  expect(screen.queryByRole('list')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开新手指引' }));
  expect(screen.getByRole('button', { name: '收起新手指引' }).getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByLabelText('学习草稿') as HTMLInputElement).value).toBe('保留输入');
});

it('shows an open guide for an empty library and provides real learning destinations', (): void => {
  render(<LearningGuide initiallyOpen />);
  expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(3);
  expect(screen.getByRole('link', { name: '打开学习中心 →' }).getAttribute('href')).toBe('/import');
  expect(screen.getByRole('link', { name: '打开班级课程 →' }).getAttribute('href')).toBe('/classes');
  expect(screen.getByRole('link', { name: '打开智能批改 →' }).getAttribute('href')).toBe('/homework');
  expect(screen.getByRole('heading', { name: '学习中心：导入与笔记' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '班级课程：任务与反馈' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '智能批改：校对与订正' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看完整使用指南 →' }).getAttribute('href')).toBe('/help#start');
});

it('explains implemented modules and hides the message shortcut when the release is closed', async (): Promise<void> => {
  render(<Help />);
  expect(screen.getByRole('heading', { level: 1, name: '使用指南' })).toBeTruthy();
  const modules = screen.getByRole('region', { name: '各个功能在哪里' });
  expect(within(modules).getAllByRole('link')).toHaveLength(7);
  expect(within(modules).getByRole('link', { name: '打开智能批改 →' }).getAttribute('href')).toBe('/homework');
  expect(within(modules).getByRole('link', { name: '打开我的班级 →' }).getAttribute('href')).toBe('/classes');
  expect(document.querySelector('a[href^="/exams"]')).toBeNull();
  expect(screen.getByText(/点击“保存到我的笔记”才会落库/)).toBeTruthy();
  expect(screen.getByText(/使用在线AI额度/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '打开打卡与人脸设置 →' }).getAttribute('href')).toBe('/attendance');
  expect(document.querySelector('a[href="/notes"]')).toBeTruthy();
  expect(document.querySelector('a[href="/messages"], a[href^="/courses"]')).toBeNull();
  await screen.findByText(/共享交流当前未开放/);
});

it('exposes messages and describes shared/private boundaries only after real availability', async (): Promise<void> => { service.messages.mockResolvedValue({unreadCount:0}); render(<Help />); expect((await screen.findByRole('link',{name:'打开消息与参与记录 →'})).getAttribute('href')).toBe('/messages'); expect(screen.getByText(/个人笔记仍在“我的资料”学习页保存/)).toBeTruthy(); expect(screen.queryByText(/评论功能尚未上线/)).toBeNull(); });
it('keeps availability unknown on read failure and offers an explicit retry', async (): Promise<void> => { service.messages.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({unreadCount:0}); render(<Help />); await screen.findByText('共享交流状态暂不可用，请重试核对。'); expect(document.querySelector('a[href="/messages"]')).toBeNull(); fireEvent.click(screen.getByRole('button',{name:'重试交流入口'})); await screen.findByRole('link',{name:'打开消息与参与记录 →'}); });
