import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAccessToken, setAccessToken } from '@/services/api';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: (): string => '/assistant', useRouter: (): typeof router => router }));
import AssistantPage from '@/app/assistant/page';

const request = vi.fn();
function token(seconds: number): string { return `header.${btoa(JSON.stringify({ sub: 'session-page-user', exp: Math.floor(Date.now() / 1_000) + seconds }))}.signature`; }
function ok(data: unknown): Response { return new Response(JSON.stringify({ success: true, data }), { status: 200 }); }
function unavailable(): Response { return new Response(JSON.stringify({ success: false, error: { code: 'INTERNAL', message: '登录续期暂不可用，请稍后重试。' } }), { status: 503 }); }
function renewed(): Response { return ok({ accessToken: token(900), user: { id: 'session-page-user' }, expiresInSec: 900 }); }
const contents = { page: 1, pageSize: 50, total: 1, items: [{ contentId: 'session-lesson', contentType: 'video', title: '续期隔离课程', status: '已就绪', understandingStatus: 'completed' }] };
const profile = { nickname: '隔离学习者', role: 'student', xpTotal: 0, currentLevel: 'Lv.1 · 新手', achievements: [] };
let firstProfile = true;
let refreshResult: () => Promise<Response>;
let navigate: ReturnType<typeof vi.spyOn>;

beforeEach((): void => {
  request.mockReset(); router.replace.mockReset(); window.localStorage.clear(); setAccessToken(token(900));
  firstProfile = true; refreshResult = (): Promise<Response> => Promise.resolve(renewed());
  request.mockImplementation((path: string): Promise<Response> => {
    if (path === '/api/auth/refresh') return refreshResult();
    if (path === '/api/gamification/profile') { const response = firstProfile ? unavailable() : ok(profile); firstProfile = false; return Promise.resolve(response); }
    if (path.startsWith('/api/contents?')) return Promise.resolve(ok(contents));
    if (path === '/api/contents/session-lesson/ai/qa') return Promise.resolve(ok({ qaId: 'session-qa', answer: '已有问答保持在页面。', citations: [], createdAt: '' }));
    return Promise.resolve(unavailable());
  });
  vi.stubGlobal('fetch', request); navigate = vi.spyOn(window.location, 'assign').mockImplementation((): void => undefined);
});
afterEach((): void => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps the real assistant draft, conversation and selected material through shared renewal', async (): Promise<void> => {
  render(<AssistantPage />);
  await screen.findByRole('button', { name: '重试账号信息' }); await screen.findByLabelText('输入学习问题');
  const input = screen.getByLabelText('输入学习问题') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '第一次学习问题' } }); fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
  await screen.findByText('已有问答保持在页面。'); fireEvent.change(input, { target: { value: '尚未发送的第二个问题' } });
  let finish!: (response: Response) => void;
  refreshResult = (): Promise<Response> => new Promise((resolve): void => { finish = resolve; });
  setAccessToken(token(-1)); fireEvent.click(screen.getByRole('button', { name: '重试账号信息' }));
  await waitFor((): void => { expect(request.mock.calls.filter((call) => call[0] === '/api/auth/refresh')).toHaveLength(1); });
  expect(input.value).toBe('尚未发送的第二个问题'); expect(screen.getByText('已有问答保持在页面。')).toBeTruthy();
  await act(async (): Promise<void> => { finish(renewed()); });
  await screen.findByLabelText('当前身份：学习者');
  expect(screen.getByLabelText('输入学习问题')).toBe(input); expect(input.value).toBe('尚未发送的第二个问题');
  expect((screen.getByLabelText('选择学习资料') as HTMLSelectElement).value).toBe('session-lesson');
  expect(navigate).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
  expect(request.mock.calls.filter((call) => call[0] === '/api/contents/session-lesson/ai/qa')).toHaveLength(1);
});

it('keeps the Agent goal and minutes when renewal fails before a write', async (): Promise<void> => {
  render(<AssistantPage />); const input = await screen.findByLabelText('输入学习问题') as HTMLTextAreaElement;
  fireEvent.click(screen.getByText(/更多学习工具/));
  fireEvent.click(screen.getByRole('button', {name: '学习 Agent'}));
  fireEvent.change(screen.getByLabelText('可用分钟'), { target: { value: '37' } });
  fireEvent.change(input, { target: { value: '请核对原文并制定复习方案' } });
  const previous = token(-1); setAccessToken(previous); refreshResult = (): Promise<Response> => Promise.resolve(unavailable());
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
  await screen.findByText('登录续期暂不可用，请稍后重试。');
  expect(input.value).toBe('请核对原文并制定复习方案');
  expect((screen.getByLabelText('可用分钟') as HTMLInputElement).value).toBe('37');
  expect(getAccessToken()).toBe(previous); expect(navigate).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
  expect(request.mock.calls.filter((call) => call[0] === '/api/assistant/agent')).toHaveLength(0);
  expect(request.mock.calls.filter((call) => call[0] === '/api/auth/refresh')).toHaveLength(1);
});
