import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ contents: vi.fn(), updateContent: vi.fn(), deleteContent: vi.fn(), progress: vi.fn() }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('main', null, children) }));
vi.mock('@/services/api', () => ({ api: m }));
import Import from '@/app/import/page';
const content = { contentId: 'c', contentType: 'document', title: '临时资料', status: '已就绪', understandingStatus: 'completed' };
beforeEach(() => { vi.resetAllMocks(); m.contents.mockResolvedValue({ items: [content] }); m.progress.mockResolvedValue({ contentType: 'document', page: 1, scrollRatio: 0, lastStudiedAt: null }); m.updateContent.mockResolvedValue({ ...content, title: '新标题' }); m.deleteContent.mockResolvedValue({ deleted: true }); });
afterEach(() => cleanup());
it('renames content through the service and keeps input after a failed save', async () => {
  m.updateContent.mockRejectedValueOnce(new Error('改名失败'));
  render(<Import />); await screen.findByText('临时资料');
  fireEvent.click(screen.getByText('改名')); fireEvent.change(screen.getByLabelText('资料标题'), { target: { value: '新标题' } });
  fireEvent.click(screen.getByText('保存标题')); await screen.findByText('改名失败');
  expect((screen.getByLabelText('资料标题') as HTMLInputElement).value).toBe('新标题');
  fireEvent.click(screen.getByText('保存标题')); await screen.findByText('新标题');
  expect(m.updateContent).toHaveBeenLastCalledWith('c', '新标题');
});
it('requires explicit confirmation before deleting and supports cancellation', async () => {
  render(<Import />); await screen.findByText('临时资料');
  fireEvent.click(screen.getByText('删除资料'));
  expect(m.deleteContent).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByText('保留资料'));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByText('删除资料'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('确认删除'));
  await waitFor(() => expect(screen.queryByText('临时资料')).toBeNull());
  expect(m.deleteContent).toHaveBeenCalledWith('c');
});
it('shows loading failure without pretending the library is empty', async () => {
  m.contents.mockRejectedValueOnce(new Error('列表失败'));
  render(<Import />); await screen.findByRole('alert');
  expect(screen.queryByText(/暂无符合条件/)).toBeNull();
  fireEvent.click(screen.getByText('刷新')); await screen.findByText('临时资料');
});
