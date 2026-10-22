import { afterEach, describe, expect, it, vi } from 'vitest';

import { signAccessToken, verifyToken } from '@/lib/auth/jwt';
import { signStorageToken } from '@/lib/storage';

const payload = { sub: 'u1', email: 'learner@example.com', role: 'student' as const };
const secureSecret = 'unit-test-secret-with-at-least-thirty-two-characters';

afterEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('JWT_SECRET', 'test-secret-only-for-unit-tests');
  vi.stubEnv('STORAGE_SIGN_SECRET', '');
});

describe('production secret requirements', () => {
  it('refuses absent, short, and known default JWT secrets in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    vi.stubEnv('JWT_SECRET', '');
    expect(() => signAccessToken(payload)).toThrow('JWT_SECRET');

    vi.stubEnv('JWT_SECRET', 'too-short');
    expect(() => signAccessToken(payload)).toThrow('JWT_SECRET');

    vi.stubEnv('JWT_SECRET', 'please-change-me-in-production');
    expect(() => signAccessToken(payload)).toThrow('JWT_SECRET');

    vi.stubEnv('JWT_SECRET', 'local-development-only-jwt-secret-not-for-production');
    expect(() => signAccessToken(payload)).toThrow('JWT_SECRET');
  });

  it('signs and verifies tokens with a sufficiently strong production secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', secureSecret);
    const token = signAccessToken(payload);
    expect(verifyToken(token)).toMatchObject(payload);
  });

  it('does not permit the local storage signing fallback in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('STORAGE_SIGN_SECRET', '');
    expect(() => signStorageToken('put', 'contents/c1/video.mp4', Date.now() + 60_000)).toThrow('STORAGE_SIGN_SECRET');
  });
});
