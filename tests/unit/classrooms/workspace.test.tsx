import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { ClassDetail } from '@/lib/classrooms/contracts';
const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), sources: vi.fn(), create: vi.fn(), join: vi.fn(), command: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/services/classrooms', () => ({ classrooms: api }));
vi.mock('next/navigation', () => ({ useRouter: (): typeof router => router }));
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }): ReactElement => <main>{children}</main> }));
vi.mock('@/components/admin/AdminShell', () => ({ AdminShell: ({ children }: { children: ReactNode }): ReactElement => <main>{children}</main> }));
import { ClassroomList, ClassroomDetail } from '@/components/classrooms/ClassroomWorkspace';
const fixture = (canManage: boolean): ClassDetail => ({ classroom: { id: 'class-a', title: '测试班', description: '', revision: 1, state: 'ACTIVE' }, canManage, memberCount: 1, chapters: [], assignments: [], members: [], invites: [] });
beforeEach((): void => { vi.clearAllMocks(); api.sources.mockResolvedValue({ items: [], page: 1, hasMore: false }); vi.stubGlobal('confirm', vi.fn((): boolean => true)); });
afterEach((): void => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps learner consent explicit and never exposes create controls', async (): Promise<void> => {
 api.list.mockResolvedValue({ canCreate: false, items: [], page: 1, hasMore: false }); render(<ClassroomList />);
 await screen.findByRole('button', { name: '加入班级' });
 expect(screen.queryByLabelText('班级名称')).toBeNull();
 fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'a'.repeat(22) } });
 fireEvent.submit(screen.getByRole('button', { name: '加入班级' }).closest('form')!);
 expect(api.join).not.toHaveBeenCalled(); expect((await screen.findByRole('alert')).textContent).toContain('请确认主动加入');
});
it('keeps a legacy administrator classroom reachable without offering a new classroom or student join', async (): Promise<void> => {
 api.list.mockResolvedValue({ canCreate: false, items: [{ id: 'legacy', title: '历史班级', description: '', state: 'ACTIVE', revision: 1 }], page: 1, hasMore: false });
 render(<ClassroomList management />);
 expect((await screen.findByRole('link', { name: '进入班级 →' })).getAttribute('href')).toBe('/admin/classes/legacy');
 expect(screen.queryByRole('button', { name: '创建班级' })).toBeNull();
 expect(screen.queryByRole('button', { name: '加入班级' })).toBeNull();
});
it('preserves draft after failure and reuses the same idempotency key for explicit retry', async (): Promise<void> => {
 api.list.mockResolvedValue({ canCreate: true, items: [], page: 1, hasMore: false }); api.create.mockRejectedValue(new Error('连接中断'));
 render(<ClassroomList />); await screen.findByLabelText('班级名称');
 fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '保留这个班名' } });
 fireEvent.click(screen.getByRole('button', { name: '创建班级' })); await screen.findByText('连接中断');
 expect((screen.getByLabelText('班级名称') as HTMLInputElement).value).toBe('保留这个班名');
 fireEvent.click(screen.getByRole('button', { name: '创建班级' })); await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
 expect(api.create.mock.calls[1][0].requestId).toBe(api.create.mock.calls[0][0].requestId);
 await screen.findByText('连接中断');
});
it('guards duplicate writes synchronously while the first request is pending', async (): Promise<void> => {
 api.list.mockResolvedValue({ canCreate: true, items: [], page: 1, hasMore: false }); let resolve: ((value: { classroomId: string; resultId: string; replayed: boolean }) => void) | undefined;
 api.create.mockImplementation(() => new Promise((done): void => { resolve = done; })); render(<ClassroomList />); await screen.findByLabelText('班级名称');
 fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '班级' } }); const form = screen.getByRole('button', { name: '创建班级' }).closest('form')!;
 fireEvent.submit(form); fireEvent.submit(form); expect(api.create).toHaveBeenCalledTimes(1);
 await act(async (): Promise<void> => { resolve?.({ classroomId: 'created', resultId: 'created', replayed: false }); });
 expect(router.push).toHaveBeenCalledWith('/classes/created');
});
it('shows published task reading without fake submission or administrator controls', async (): Promise<void> => {
 const data = fixture(false); data.assignments.push({ id: 'task', chapterId: null, title: '阅读任务', instructions: '阅读并梳理定义', state: 'PUBLISHED', dueAt: '2099-01-01T00:00:00Z', revision: 1 }); api.read.mockResolvedValue(data);
 render(<ClassroomDetail id="class-a" />); await screen.findByText('测试班'); fireEvent.click(screen.getByRole('button', { name: '学习任务' }));
 expect(await screen.findByText('阅读任务')).toBeTruthy(); expect(screen.getByText(/打开任务可保存草稿、提交作业或查看批阅/)).toBeTruthy();
 expect(screen.queryByRole('button', { name: '成员与设置' })).toBeNull(); expect(screen.queryByRole('button', { name: '提交作业' })).toBeNull(); expect(api.sources).not.toHaveBeenCalled();
});
it('preserves unsaved chapter input on conflict and requires re-read instead of overwriting', async (): Promise<void> => {
 api.read.mockResolvedValue(fixture(true)); api.command.mockRejectedValue(new Error('内容已更新，请重新读取后操作'));
 render(<ClassroomDetail id="class-a" management />); await screen.findByLabelText('章节说明');
 fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新的章节' } }); fireEvent.change(screen.getByLabelText('章节说明'), { target: { value: '保留正文' } }); fireEvent.click(screen.getByRole('button', { name: '保存章节' }));
 await screen.findByText('内容已更新，请重新读取后操作'); expect((screen.getByLabelText('章节说明') as HTMLTextAreaElement).value).toBe('保留正文'); expect(api.command).toHaveBeenCalledTimes(1);
});

it('drops an explicitly discarded source selection when re-reading a newer chapter', async (): Promise<void> => {
 const original = fixture(true); original.chapters.push({ id: 'chapter-a', title: '已发布章', body: '正文', sequence: 0, state: 'PUBLISHED', revision: 1, sharedCourseId: 'source-one', sourceAvailable: true });
 const newer = structuredClone(original); newer.classroom.revision = 2; newer.chapters[0].revision = 2; newer.chapters[0].sharedCourseId = 'source-two';
 api.sources.mockResolvedValue({ items: [{ id: 'source-one', title: '原资料' }, { id: 'source-two', title: '新资料' }, { id: 'unsaved-source', title: '未保存资料' }], page: 1, hasMore: false });
 api.read.mockResolvedValueOnce(original).mockResolvedValue(newer);
 render(<ClassroomDetail id="class-a" management />); fireEvent.click(await screen.findByRole('button', { name: '编辑章节' }));
 const source = document.querySelector('select[name="source"]') as HTMLSelectElement;
 await waitFor(() => expect(source.options.length).toBe(4)); fireEvent.change(source, { target: { value: 'unsaved-source' } }); expect(source.value).toBe('unsaved-source');
 fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
 await waitFor(() => expect((document.querySelector('select[name="source"]') as HTMLSelectElement).value).toBe('source-two'));
 expect(api.command).not.toHaveBeenCalled();
});

