// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isSessionRequest } from '@/lib/auth/same-origin';

function request(origin: string, url = 'http://internal:3000/api/auth/refresh', extras: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { origin, 'x-session-refresh': '1', ...extras } });
}
beforeEach((): void => { vi.stubEnv('APP_URL', 'http://localhost:3000'); });
afterEach((): void => { vi.unstubAllEnvs(); });

it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])('accepts the configured local origin and bounded alias %s', (origin): void => {
  expect(isSessionRequest(request(origin))).toBe(true);
});
it.each(['http://localhost:3001', 'https://localhost:3000', 'http://127.0.0.2:3000', 'http://localhost.evil.test:3000', 'https://evil.test', 'null', 'http://localhost:3000/path', 'http://user:password@localhost:3000', 'http://localhost:3000#fragment'])('rejects other ports, protocols, hosts or malformed origins %s', (origin): void => {
  expect(isSessionRequest(request(origin))).toBe(false);
});
it('continues rejecting cross-site and missing JS protection on allowed aliases', (): void => {
  expect(isSessionRequest(request('http://127.0.0.1:3000', undefined, { 'sec-fetch-site': 'cross-site' }))).toBe(false);
  expect(isSessionRequest(request('http://127.0.0.1:3000', undefined, { 'x-session-refresh': '' }))).toBe(false);
});
it('accepts a configured HTTPS public origin behind an internal proxy, not its internal URL', (): void => {
  vi.stubEnv('APP_URL', 'https://study.example.test');
  expect(isSessionRequest(request('https://study.example.test'))).toBe(true);
  expect(isSessionRequest(request('http://internal:3000'))).toBe(false);
});
it('ignores attacker-controlled host and forwarding headers', (): void => {
  vi.stubEnv('APP_URL', 'https://study.example.test');
  expect(isSessionRequest(request('https://evil.test', 'https://evil.test/api/auth/refresh', { host: 'evil.test', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' }))).toBe(false);
});
it('rejects missing or invalid production configuration', (): void => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_URL', '');
  expect(isSessionRequest(request('http://localhost:3000', 'http://localhost:3000/api/auth/refresh'))).toBe(false);
  vi.stubEnv('APP_URL', 'not a URL');
  expect(isSessionRequest(request('http://localhost:3000'))).toBe(false);
});
it('retains strict request-origin fallback only for unconfigured development', (): void => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('APP_URL', '');
  expect(isSessionRequest(request('http://localhost:3000', 'http://localhost:3000/api/auth/refresh'))).toBe(true);
  expect(isSessionRequest(request('http://127.0.0.1:3000', 'http://localhost:3000/api/auth/refresh'))).toBe(false);
});
