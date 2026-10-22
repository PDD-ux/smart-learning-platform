import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { signAccessToken } from '@/lib/auth/jwt';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: {
    findUnique: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
const objectCleanup = vi.hoisted(() => ({
  deleteEnrollmentPhoto: vi.fn(async () => undefined),
  scheduleContentCleanup: vi.fn(async () => undefined),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async (value: string) => `hash:${value}`) }));
vi.mock('@/lib/face/enrollment-photo', () => ({ deleteEnrollmentPhoto: objectCleanup.deleteEnrollmentPhoto }));
vi.mock('@/lib/jobs/cleanup', () => ({ scheduleContentCleanup: objectCleanup.scheduleContentCleanup }));

import { GET, POST } from '@/app/api/admin/users/route';
import { DELETE, PATCH } from '@/app/api/admin/users/[id]/route';

function request(path: string, token: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const adminToken = signAccessToken({ sub: 'admin-1', email: 'admin@example.com', role: 'admin' });
const studentToken = signAccessToken({ sub: 'student-1', email: 'student@example.com', role: 'student' });
const teacherToken = signAccessToken({ sub: 'teacher-1', email: 'teacher@example.com', role: 'teacher' });

describe('admin user management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (action: unknown): Promise<unknown> => typeof action === 'function' ? action(prismaMock) : Promise.all(action as Promise<unknown>[]));
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ role: where.id === 'admin-1' ? 'admin' : where.id === 'teacher-1' ? 'teacher' : 'student', _count: { responsibleClassrooms: 0, sharedCourses: 0 } }));
  });

  it('allows administrators to list users', async () => {
    prismaMock.user.count.mockResolvedValueOnce(1);
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'student-1', email: 'student@example.com', phone: null, nickname: '小明', role: 'student', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') }]);
    const response = await GET(request('/api/admin/users?pageSize=10', adminToken));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.items[0]).toMatchObject({ nickname: '小明', role: 'student', isCurrent: false });
  });

  it('rejects ordinary users before touching the database', async () => {
    const response = await POST(request('/api/admin/users', studentToken, 'POST', { account: 'new@example.com', nickname: '新用户', password: 'Password123!', role: 'student' }));
    expect(response.status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('lets an administrator create and filter teacher accounts while denying teacher access to user management', async (): Promise<void> => {
    prismaMock.user.create.mockResolvedValueOnce({ id: 'teacher-1', email: 'teacher@example.com', phone: null, nickname: '授课教师', role: 'teacher', createdAt: new Date(), updatedAt: new Date() });
    const created = await POST(request('/api/admin/users', adminToken, 'POST', { account: 'teacher@example.com', nickname: '授课教师', password: 'Password123!', role: 'teacher' }));
    expect(created.status).toBe(201);
    expect((await created.json()).data.user.role).toBe('teacher');
    prismaMock.user.count.mockResolvedValueOnce(1);
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    expect((await GET(request('/api/admin/users?role=teacher', adminToken))).status).toBe(200);
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: { role: 'teacher' } });
    expect((await GET(request('/api/admin/users', teacherToken))).status).toBe(403);
  });

  it('preserves a teacher account that still owns a class or shared course when demoting', async (): Promise<void> => {
    for (const relation of ['responsibleClassrooms', 'sharedCourses'] as const) {
      prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce({ role: 'teacher', _count: { responsibleClassrooms: 0, sharedCourses: 0, [relation]: 1 } });
      const response = await PATCH(request('/api/admin/users/teacher-1', adminToken, 'PATCH', { role: 'student' }), { params: { id: 'teacher-1' } });
      expect(response.status).toBe(409);
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('prevents an administrator from deleting the current account', async () => {
    const response = await DELETE(request('/api/admin/users/admin-1', adminToken, 'DELETE'), { params: { id: 'admin-1' } });
    expect(response.status).toBe(403);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('rejects a demoted administrator even while the old JWT says admin', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'student' });
    const response = await GET(request('/api/admin/users', adminToken));
    expect(response.status).toBe(403);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('rejects a deleted administrator even while the old JWT is valid', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const response = await GET(request('/api/admin/users', adminToken));
    expect(response.status).toBe(401);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('allows a newly promoted administrator based on the current database role', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin' });
    prismaMock.user.count.mockResolvedValueOnce(0);
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    const response = await GET(request('/api/admin/users', studentToken));
    expect(response.status).toBe(200);
  });

  it('creates a user with a hashed password and no password in the response', async () => {
    prismaMock.user.create.mockResolvedValueOnce({ id: 'new-1', email: 'new@example.com', phone: null, nickname: '新用户', role: 'student', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });
    const response = await POST(request('/api/admin/users', adminToken, 'POST', { account: 'new@example.com', nickname: '新用户', password: 'Password123!', role: 'student' }));
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com', passwordHash: 'hash:Password123!' }) }));
    expect(JSON.stringify(payload)).not.toContain('Password123!');
  });

  it('updates a user and blocks demoting the current administrator', async () => {
    prismaMock.user.update.mockResolvedValueOnce({ id: 'student-1', email: 'student@example.com', phone: null, nickname: '新昵称', role: 'student', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') });
    const updated = await PATCH(request('/api/admin/users/student-1', adminToken, 'PATCH', { nickname: '新昵称', password: 'NewPassword123!' }), { params: { id: 'student-1' } });
    expect(updated.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nickname: '新昵称', passwordHash: 'hash:NewPassword123!' }) }));

    const forbidden = await PATCH(request('/api/admin/users/admin-1', adminToken, 'PATCH', { role: 'student' }), { params: { id: 'admin-1' } });
    expect(forbidden.status).toBe(403);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
  });

  it('deletes another user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce({ contents: [{ id: 'content-1' }], faceTemplate: { enrollmentPhotoKey: 'face-enrollment/photo-1' }, _count: { responsibleClassrooms: 0, classMemberships: 0, classroomOperations: 0 } });
    prismaMock.user.delete.mockResolvedValueOnce({ id: 'student-1' });
    const response = await DELETE(request('/api/admin/users/student-1', adminToken, 'DELETE'), { params: { id: 'student-1' } });
    expect(response.status).toBe(200);
    expect(objectCleanup.deleteEnrollmentPhoto).toHaveBeenCalledWith('face-enrollment/photo-1');
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'student-1' } });
    expect(objectCleanup.scheduleContentCleanup).toHaveBeenCalledWith('content-1');
  });

  it('keeps the account when private photo deletion fails', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce({ contents: [], faceTemplate: { enrollmentPhotoKey: 'face-enrollment/photo-1' }, _count: { responsibleClassrooms: 0, classMemberships: 0, classroomOperations: 0 } });
    objectCleanup.deleteEnrollmentPhoto.mockRejectedValueOnce(new Error('storage unavailable'));
    const response = await DELETE(request('/api/admin/users/student-1', adminToken, 'DELETE'), { params: { id: 'student-1' } });
    expect(response.status).toBe(503);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('returns not found without deleting objects for an unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce(null);
    const response = await DELETE(request('/api/admin/users/missing', adminToken, 'DELETE'), { params: { id: 'missing' } });
    expect(response.status).toBe(404);
    expect(objectCleanup.deleteEnrollmentPhoto).not.toHaveBeenCalled();
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it.each(['responsibleClassrooms', 'classMemberships', 'classroomOperations', 'sharedCourses'])('preserves private photos and data when %s retains ownership or history', async (relation): Promise<void> => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce({ contents: [{ id: 'private' }], faceTemplate: { enrollmentPhotoKey: 'face-enrollment/private' }, _count: { responsibleClassrooms: 0, classMemberships: 0, classroomOperations: 0, sharedCourses: 0, [relation]: 1 } });
    const response = await DELETE(request('/api/admin/users/student-1', adminToken, 'DELETE'), { params: { id: 'student-1' } });
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('CLASSROOM_CONFLICT');
    expect(objectCleanup.deleteEnrollmentPhoto).not.toHaveBeenCalled(); expect(prismaMock.user.delete).not.toHaveBeenCalled(); expect(objectCleanup.scheduleContentCleanup).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});
