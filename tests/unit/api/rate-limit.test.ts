import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({
  redisIncrWithTtl: vi.fn(async () => {
    throw new Error('redis unavailable');
  }),
}));

import { getClientIp, rateLimit } from '@/lib/api/rate-limit';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('rate limit resilience', () => {
  it('keeps enforcing a per-process fallback limit when Redis is unavailable', async () => {
    const key = `fallback-${Date.now()}`;
    expect((await rateLimit(key, 1, 60_000)).allowed).toBe(true);
    const limited = await rateLimit(key, 1, 60_000);
    expect(limited).toMatchObject({ allowed: false, remaining: 0 });
    expect(limited.retryAfter).toBeGreaterThan(0);
  });

  it('enforces the exact limit boundary and resets the fallback window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
    const key = `boundary-${Math.random()}`;

    await expect(rateLimit(key, 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 1, retryAfter: 0 });
    await expect(rateLimit(key, 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 0, retryAfter: 0 });
    await expect(rateLimit(key, 2, 60_000)).resolves.toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 });

    vi.advanceTimersByTime(60_001);
    await expect(rateLimit(key, 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 1, retryAfter: 0 });
  });

  it('reads the real client IP from forwarded headers (rightmost = proxy-written)', () => {
    const request = new Request('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.3', 'x-real-ip': '198.51.100.3' },
    });
    expect(getClientIp(request)).toBe('198.51.100.3');

    const noHeaders = new Request('http://localhost/api/auth/login');
    expect(getClientIp(noHeaders)).toBe('unknown');
  });
});
