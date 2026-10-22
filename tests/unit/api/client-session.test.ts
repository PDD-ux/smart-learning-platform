import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, getAccessToken, setAccessToken } from '@/services/api';

const request = vi.fn();
function token(seconds: number, sub = 'u1'): string { return `header.${btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1_000) + seconds }))}.signature`; }
function ok(data: unknown): Response { return new Response(JSON.stringify({ success: true, data }), { status: 200 }); }
function failed(status: number, code = 'UNAUTHENTICATED'): Response { return new Response(JSON.stringify({ success: false, error: { code, message: 'test failure' } }), { status }); }
function renewed(sub = 'u1'): Response { return ok({ accessToken: token(900, sub), user: { id: sub }, expiresInSec: 900 }); }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } { let resolve!: (value: T) => void; return { promise: new Promise<T>((done): void => { resolve = done; }), resolve: (value: T): void => resolve(value) }; }
let navigate: ReturnType<typeof vi.spyOn>;
beforeEach((): void => { request.mockReset(); vi.stubGlobal('fetch', request); window.localStorage.clear(); setAccessToken(token(900)); navigate = vi.spyOn(window.location, 'assign').mockImplementation((): void => undefined); });
afterEach((): void => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('renews before an expired write and sends the write only once with fresh auth', async (): Promise<void> => {
  setAccessToken(token(-1)); request.mockResolvedValueOnce(renewed()).mockResolvedValueOnce(ok({ saved: true }));
  expect(await apiRequest('/api/study-plans', { method: 'POST', body: { title: 'draft' } })).toEqual({ saved: true });
  expect(request.mock.calls.map((call) => call[0])).toEqual(['/api/auth/refresh', '/api/study-plans']);
  expect(new Headers(request.mock.calls[0][1].headers).get('X-Session-Refresh')).toBe('1');
  expect(new Headers(request.mock.calls[1][1].headers).get('Authorization')).toBe(`Bearer ${getAccessToken()}`);
  expect(navigate).not.toHaveBeenCalled();
});
it('shares one renewal across concurrent requests', async (): Promise<void> => {
  setAccessToken(token(1)); const wait = deferred<Response>();
  request.mockImplementation((path: string): Promise<Response> => path === '/api/auth/refresh' ? wait.promise : Promise.resolve(ok(path)));
  const one = apiRequest('/api/contents'); const two = apiRequest('/api/mastery');
  expect(request).toHaveBeenCalledTimes(1); wait.resolve(renewed()); expect(await Promise.all([one, two])).toEqual(['/api/contents', '/api/mastery']);
  expect(request.mock.calls.filter((call) => call[0] === '/api/auth/refresh')).toHaveLength(1);
});
it('allows one canceled waiter without canceling shared renewal', async (): Promise<void> => {
  setAccessToken(token(1)); const wait = deferred<Response>(); const abort = new AbortController();
  request.mockImplementation((path: string): Promise<Response> => path === '/api/auth/refresh' ? wait.promise : Promise.resolve(ok('done')));
  const one = apiRequest('/api/contents', { signal: abort.signal }); const rejected = expect(one).rejects.toMatchObject({ name: 'AbortError' });
  const two = apiRequest('/api/mastery'); abort.abort(); await rejected;
  expect(request.mock.calls[0][1].signal.aborted).toBe(false); wait.resolve(renewed()); expect(await two).toBe('done');
});
it('retries a confirmed unauthorized read once without navigation', async (): Promise<void> => {
  request.mockResolvedValueOnce(failed(401)).mockResolvedValueOnce(renewed()).mockResolvedValueOnce(ok('done'));
  expect(await apiRequest('/api/contents')).toBe('done'); expect(request.mock.calls.map((call) => call[0])).toEqual(['/api/contents', '/api/auth/refresh', '/api/contents']); expect(navigate).not.toHaveBeenCalled();
});
it('does not replay a write rejected with 401', async (): Promise<void> => {
  request.mockResolvedValueOnce(failed(401)).mockResolvedValueOnce(renewed());
  await expect(apiRequest('/api/exercises/q1/answer', { method: 'POST', body: { userAnswer: 'B' } })).rejects.toMatchObject({ code: 'SESSION_RENEWED_RETRY', status: 409 });
  expect(request).toHaveBeenCalledTimes(2); expect(navigate).not.toHaveBeenCalled();
});
it('preserves token and page on temporary failure and allows a later retry', async (): Promise<void> => {
  const previous = token(-1); setAccessToken(previous); request.mockRejectedValueOnce(new TypeError('offline'));
  await expect(apiRequest('/api/contents')).rejects.toMatchObject({ code: 'SESSION_REFRESH_UNAVAILABLE' });
  expect(getAccessToken()).toBe(previous); expect(navigate).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(renewed()).mockResolvedValueOnce(ok('done')); expect(await apiRequest('/api/contents')).toBe('done');
});
it('clears auth only on confirmed failed renewal', async (): Promise<void> => {
  setAccessToken(token(-1)); request.mockResolvedValueOnce(failed(401)); await expect(apiRequest('/api/contents')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(getAccessToken()).toBeNull(); expect(navigate).toHaveBeenCalledWith('/login'); expect(request).toHaveBeenCalledTimes(1);
});
it('preserves a valid session on forbidden business requests and failed public login', async (): Promise<void> => {
  const previous = getAccessToken(); request.mockResolvedValueOnce(failed(403, 'FORBIDDEN')).mockResolvedValueOnce(failed(401, 'INVALID_CREDENTIALS'));
  await expect(apiRequest('/api/admin/users')).rejects.toMatchObject({ status: 403 });
  await expect(apiRequest('/api/auth/login', { method: 'POST' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  expect(getAccessToken()).toBe(previous); expect(request).toHaveBeenCalledTimes(2); expect(navigate).not.toHaveBeenCalled();
});
it('does not restore login when logout finishes before a late renewal', async (): Promise<void> => {
  setAccessToken(token(-1)); const wait = deferred<Response>(); request.mockImplementation((path: string): Promise<Response> => path === '/api/auth/refresh' ? wait.promise : Promise.resolve(ok({ loggedOut: true })));
  const pending = apiRequest('/api/contents'); const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  await apiRequest('/api/auth/logout', { method: 'POST' }); expect(getAccessToken()).toBeNull(); wait.resolve(renewed()); await rejected;
  expect(getAccessToken()).toBeNull(); expect(request.mock.calls.map((call) => call[0])).toEqual(['/api/auth/refresh', '/api/auth/logout']);
});
it('does not assign old work to a new login or a different refresh subject', async (): Promise<void> => {
  setAccessToken(token(-1)); const wait = deferred<Response>(); request.mockReturnValueOnce(wait.promise);
  const pending = apiRequest('/api/contents'); const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  const next = token(900, 'u2'); setAccessToken(next); wait.resolve(renewed()); await rejected; expect(getAccessToken()).toBe(next);
  setAccessToken(token(-1)); request.mockResolvedValueOnce(renewed('u2')); await expect(apiRequest('/api/contents')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(navigate).not.toHaveBeenCalled();
});
it('invalidates in-flight work on another tab storage change', async (): Promise<void> => {
  setAccessToken(token(-1)); const wait = deferred<Response>(); request.mockReturnValueOnce(wait.promise);
  const pending = apiRequest('/api/contents'); const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  window.localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); wait.resolve(renewed()); await rejected; expect(getAccessToken()).toBeNull();
});
it('stops after a second 401 instead of a renewal loop', async (): Promise<void> => {
  request.mockResolvedValueOnce(failed(401)).mockResolvedValueOnce(renewed()).mockResolvedValueOnce(failed(401));
  await expect(apiRequest('/api/contents')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(request).toHaveBeenCalledTimes(3); expect(navigate).toHaveBeenCalledTimes(1);
});

it('uses the already renewed token for a late 401 without another renewal', async (): Promise<void> => {
  setAccessToken(token(600));
  const wait = deferred<Response>(); let calls = 0;
  request.mockImplementation((path: string): Promise<Response> => {
    if (path === '/api/slow') return ++calls === 1 ? wait.promise : Promise.resolve(ok('slow done'));
    if (path === '/api/auth/refresh') return Promise.resolve(renewed());
    return Promise.resolve(failed(401));
  });
  const slow = apiRequest('/api/slow');
  await expect(apiRequest('/api/fast', { method: 'POST' })).rejects.toMatchObject({ code: 'SESSION_RENEWED_RETRY' });
  wait.resolve(failed(401)); expect(await slow).toBe('slow done');
  expect(request.mock.calls.filter((call) => call[0] === '/api/auth/refresh')).toHaveLength(1);
});

it.each([403, 429, 503])('preserves session on temporary or forbidden refresh status %i', async (status): Promise<void> => {
  const previous = token(-1); setAccessToken(previous); request.mockResolvedValueOnce(failed(status, 'TEMPORARY'));
  await expect(apiRequest('/api/contents')).rejects.toMatchObject({ status });
  expect(getAccessToken()).toBe(previous); expect(navigate).not.toHaveBeenCalled();
});

it('does not discard a session on a malformed success response', async (): Promise<void> => {
  const previous = token(-1); setAccessToken(previous); request.mockResolvedValueOnce(ok({ user: { id: 'u1' } }));
  await expect(apiRequest('/api/contents')).rejects.toMatchObject({ code: 'SESSION_REFRESH_UNAVAILABLE' });
  expect(getAccessToken()).toBe(previous); expect(navigate).not.toHaveBeenCalled();
});

it('sends no request for a previously aborted caller', async (): Promise<void> => {
  setAccessToken(token(-1)); const abort = new AbortController(); abort.abort();
  await expect(apiRequest('/api/contents', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).not.toHaveBeenCalled();
});

it('bounds a renewal to 15 seconds and leaves input/session recoverable', async (): Promise<void> => {
  vi.useFakeTimers();
  try {
    const previous = token(-1); setAccessToken(previous);
    request.mockImplementation((_path: string, options: RequestInit): Promise<Response> => new Promise((_resolve, reject): void => { options.signal!.addEventListener('abort', (): void => reject(new DOMException('Timeout', 'AbortError')), { once: true }); }));
    const pending = apiRequest('/api/contents'); const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_REFRESH_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(getAccessToken()).toBe(previous); expect(navigate).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
