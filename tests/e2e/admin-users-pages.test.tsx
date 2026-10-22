import { createElement, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
}));

type TestLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };
type TestShellProps = { children: ReactNode };

vi.mock('next/link', () => ({
  default: function TestLink({ children, ...props }: TestLinkProps): ReactElement {
    return createElement('a', props, children);
  },
}));

vi.mock('@/components/admin/AdminShell', () => ({
  AdminShell: function TestAdminShell({ children }: TestShellProps): ReactElement {
    return createElement('div', null, children);
  },
}));

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      adminUsers: mocks.adminUsers,
      createAdminUser: mocks.createAdminUser,
      updateAdminUser: mocks.updateAdminUser,
      deleteAdminUser: mocks.deleteAdminUser,
    },
  };
});

import AdminUsersPage from '@/app/admin/users/page';

const student = {
  id: 'student-1',
  email: 'student@example.com',
  phone: null,
  nickname: '小明',
  role: 'student' as const,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
  isCurrent: false,
};

const currentAdmin = {
  ...student,
  id: 'admin-1',
  email: 'admin@example.com',
  nickname: '平台管理员',
  role: 'admin' as const,
  isCurrent: true,
};

function users(items: Array<typeof student | typeof currentAdmin> = [student]): { page: number; pageSize: number; total: number; items: Array<typeof student | typeof currentAdmin> } {
  return { page: 1, pageSize: 8, total: items.length, items };
}

describe('administrator user management page', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.adminUsers.mockResolvedValue(users());
    mocks.createAdminUser.mockResolvedValue({ user: student });
    mocks.updateAdminUser.mockResolvedValue({ user: student });
    mocks.deleteAdminUser.mockResolvedValue({ id: student.id, deleted: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('queries the account list and applies search and role filters', async () => {
    render(createElement(AdminUsersPage));
    expect(await screen.findByText('小明')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('搜索邮箱、手机号或昵称…'), { target: { value: 'student@example.com' } });
    await waitFor(() => expect(mocks.adminUsers).toHaveBeenCalledWith(expect.objectContaining({ query: 'student@example.com' })));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'student' } });
    await waitFor(() => expect(mocks.adminUsers).toHaveBeenCalledWith(expect.objectContaining({ query: 'student@example.com', role: 'student' })));
  });
  it('ignores a late list from the previous filter', async (): Promise<void> => {
    let resolve!: (result: ReturnType<typeof users>) => void;
    mocks.adminUsers.mockImplementationOnce(() => new Promise<ReturnType<typeof users>>((done) => { resolve = done; })).mockResolvedValueOnce(users([{ ...student, nickname: '最新筛选结果' }]));
    render(<AdminUsersPage />);
    fireEvent.change(screen.getByPlaceholderText('搜索邮箱、手机号或昵称…'), { target: { value: '新筛选' } });
    await screen.findByText('最新筛选结果');
    await act(async (): Promise<void> => { resolve(users()); });
    expect(screen.queryByText('小明')).toBeNull();
    expect(screen.getByText('最新筛选结果')).toBeTruthy();
  });
  it('locks duplicate saves and preserves an editing draft on write failure', async (): Promise<void> => {
    let reject!: (reason: unknown) => void;
    mocks.updateAdminUser.mockImplementationOnce(() => new Promise<unknown>((_done, failure) => { reject = failure; }));
    render(<AdminUsersPage />); await screen.findByText('小明');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '保留草稿' } });
    const form = screen.getByRole('heading', { name: '编辑用户' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.updateAdminUser).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('昵称').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    await act(async (): Promise<void> => { reject(new Error('保存断开')); });
    await screen.findByText('保存断开');
    expect((screen.getByLabelText('昵称') as HTMLInputElement).value).toBe('保留草稿');
    expect(screen.queryByText('用户信息已更新')).toBeNull();
  });

  it('creates an account from the page form', async () => {
    render(createElement(AdminUsersPage));
    await screen.findByText('小明');
    fireEvent.click(screen.getByRole('button', { name: /新增用户/ }));

    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新同学' } });
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'student' } });

    const form = screen.getByRole('heading', { name: '新增用户' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(mocks.createAdminUser).toHaveBeenCalledWith({
      account: 'new@example.com',
      nickname: '新同学',
      password: 'Password123!',
      role: 'student',
    }));
    expect(await screen.findByText('用户创建成功')).toBeTruthy();
  });

  it('edits a user and deletes the account after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(createElement(AdminUsersPage));
    await screen.findByText('小明');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新昵称' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'admin' } });
    const editForm = screen.getByRole('heading', { name: '编辑用户' }).closest('form');
    expect(editForm).not.toBeNull();
    fireEvent.submit(editForm as HTMLFormElement);

    await waitFor(() => expect(mocks.updateAdminUser).toHaveBeenCalledWith('student-1', { nickname: '新昵称', role: 'admin' }));
    expect(await screen.findByText('用户信息已更新')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mocks.deleteAdminUser).toHaveBeenCalledWith('student-1'));
    expect(window.confirm).toHaveBeenCalled();
    expect(await screen.findByText('用户已删除')).toBeTruthy();
  });

  it('disables deletion of the current administrator account', async () => {
    mocks.adminUsers.mockResolvedValue(users([currentAdmin]));
    render(createElement(AdminUsersPage));
    await screen.findByText('平台管理员（当前账号）');
    expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true);
  });
});
