import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}));

import { signAccessToken } from '@/lib/auth/jwt';
import { GET } from '@/app/api/gamification/profile/route';

const token = signAccessToken({ sub: 'u1', email: 'student@example.com', role: 'student' });

function request(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/gamification/profile', { headers });
}

describe('GET /api/gamification/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue({
      nickname: '小明',
      role: 'student',
      xpTotal: 320,
      achievements: [
        { achievementKey: 'XP_300', unlockedAt: new Date('2026-09-17T00:00:00.000Z') },
      ],
    });
  });

  it('returns level and the complete achievement catalog', async () => {
    const response = await GET(request(), {});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.nickname).toBe('小明');
    expect(body.data.role).toBe('student');
    expect(body.data.xpTotal).toBe(320);
    expect(body.data.currentLevel).toBe('Lv.3 · 高手');
    expect(body.data.achievements).toHaveLength(6);
    expect(body.data.achievements.find((item: { key: string }) => item.key === 'XP_300')).toMatchObject({
      unlocked: true,
      unlockedAt: '2026-09-17T00:00:00.000Z',
    });
  });

  it('requires authentication', async () => {
    const response = await GET(request(false), {});
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
  });
});
