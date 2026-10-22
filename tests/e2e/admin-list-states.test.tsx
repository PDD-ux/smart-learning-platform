import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ adminUsers: vi.fn(), list: vi.fn() }));
vi.mock('@/services/api', () => ({ api: m, ApiClientError: class extends Error {} }));
vi.mock('@/services/attendance', () => ({ attendanceApi: m }));
vi.mock('@/components/admin/AdminShell', () => ({ AdminShell: ({ children }: { children: ReactNode }): ReactElement => createElement('main', null, children) }));
import Users from '@/app/admin/users/page';
import Attendance from '@/app/admin/attendance/page';
beforeEach((): void => { vi.resetAllMocks(); m.adminUsers.mockResolvedValue({ items: [], total: 0 }); m.list.mockResolvedValue({ items: [], total: 0 }); });
afterEach(cleanup);
it('does not let a late attendance response override the current filter', async (): Promise<void> => {
  let resolve!: (result: { items: never[]; total: number }) => void;
  m.list.mockImplementationOnce(() => new Promise<{ items: never[]; total: number }>((done) => { resolve = done; })).mockResolvedValueOnce({ items: [], total: 0 });
  render(<Attendance />);
  fireEvent.change(screen.getByPlaceholderText('按用户 ID 查询'), { target: { value: 'current-user' } });
  await screen.findByText(/共 0 条记录/);
  await act(async (): Promise<void> => { resolve({ items: [], total: 999 }); });
  expect(screen.queryByText(/共 999 条记录/)).toBeNull();
  expect(screen.getByText(/共 0 条记录/)).toBeTruthy();
});
it('does not show an empty administrator account list or zero total after a failed read', async (): Promise<void> => {
  m.adminUsers.mockRejectedValueOnce(new Error('读取断开')); render(<Users />); await screen.findByText(/用户列表读取失败/);
  expect(screen.queryByText(/共 0 个账号/)).toBeNull(); expect(screen.queryByText('没有找到符合条件的用户。')).toBeNull();
  expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' })); await screen.findByText(/共 0 个账号/); expect(screen.getByText('没有找到符合条件的用户。')).toBeTruthy();
});
it('keeps pending or failed attendance totals unknown until a successful zero result', async (): Promise<void> => {
  m.list.mockReturnValueOnce(new Promise<never>(() => undefined)); render(<Attendance />); expect(screen.queryByText(/共 0 条记录/)).toBeNull(); expect(screen.queryByText(/没有符合当前筛选/)).toBeNull();
  cleanup(); m.list.mockRejectedValueOnce(new Error('断开')); render(<Attendance />); await screen.findByText(/签到记录读取失败/);
  expect(screen.queryByText(/共 0 条记录/)).toBeNull(); expect(screen.queryByText(/没有符合当前筛选/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新' })); await screen.findByText(/共 0 条记录/); expect(screen.getByText('没有符合当前筛选条件的签到记录。')).toBeTruthy();
});
