import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { signAccessToken } from '@/lib/auth/jwt';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  user: {
    findUnique: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
  attendanceRecord: { count: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/admin/overview/route';

const adminToken = signAccessToken({ sub: 'admin-1', email: 'admin@example.com', role: 'admin' });
const studentToken = signAccessToken({ sub: 'student-1', email: 'student@example.com', role: 'student' });

function request(token?: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/overview', {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe('GET /api/admin/overview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ role: where.id === 'admin-1' ? 'admin' : 'student' }));
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.attendanceRecord.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('requires an authenticated session', async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a learner before reading overview data', async () => {
    const response = await GET(request(studentToken));
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('checks the current database role instead of trusting an old admin token', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'student' });
    const response = await GET(request(adminToken));
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns only the minimum account fields with Shanghai-day attendance totals', async () => {
    const createdAt = new Date('2026-10-09T03:00:00.000Z');
    prismaMock.user.count.mockResolvedValueOnce(12).mockResolvedValueOnce(10).mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    prismaMock.attendanceRecord.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'student-1', nickname: '小明', role: 'student', createdAt }]);

    const response = await GET(request(adminToken));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      users: { total: 12, students: 10, teachers: 0, admins: 2, recent: [{ id: 'student-1', nickname: '小明', role: 'student', createdAt: createdAt.toISOString() }] },
      attendance: { total: 5, signedIn: 3, selfCheckIn: 1, manualConfirmation: 1 },
    });
    expect(payload.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 5,
      select: { id: true, nickname: true, role: true, createdAt: true },
    }));
    expect(JSON.stringify(payload)).not.toMatch(/email|phone|password|face|similarity/i);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});


