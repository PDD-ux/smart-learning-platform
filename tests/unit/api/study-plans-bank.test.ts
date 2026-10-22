import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  content: vi.fn(), create: vi.fn(), count: vi.fn(), plans: vi.fn(), update: vi.fn(), find: vi.fn(), remove: vi.fn(), exercises: vi.fn(), exerciseCount: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  learningContent: { findUnique: mocks.content },
  learningPlan: { create: mocks.create, count: mocks.count, findMany: mocks.plans, updateMany: mocks.update, findFirst: mocks.find, deleteMany: mocks.remove },
  exercise: { count: mocks.exerciseCount, findMany: mocks.exercises },
  $transaction: (queries: Promise<unknown>[]): Promise<unknown[]> => Promise.all(queries),
} }));
import { signAccessToken } from '@/lib/auth/jwt';
import { GET as plans, POST as create } from '@/app/api/study-plans/route';
import { PATCH, DELETE } from '@/app/api/study-plans/[id]/route';
import { GET as exercises } from '@/app/api/exercises/route';
const body = { contentId: 'c1', title: '复习梯度', targetMinutes: 30, scheduledAt: '2026-10-08T10:00:00Z', remindAt: '2026-10-08T09:00:00Z' };
const plan = { ...body, id: 'plan1', ownerId: 'u1', scheduledAt: new Date(body.scheduledAt), remindAt: new Date(body.remindAt), completedAt: null, createdAt: new Date(), updatedAt: new Date(), content: { title: '课程' } };
function request(path: string, method = 'GET', payload?: unknown, role: 'admin' | 'student' = 'student'): NextRequest {
  return new NextRequest('http://localhost/api/' + path, { method, headers: { authorization: 'Bearer ' + signAccessToken({ sub: 'u1', email: 'a@b.com', role }), 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.count.mockResolvedValue(1); mocks.plans.mockResolvedValue([plan]); mocks.content.mockResolvedValue({ ownerId: 'u1' }); mocks.create.mockResolvedValue(plan); mocks.update.mockResolvedValue({ count: 1 }); mocks.find.mockResolvedValue(plan); mocks.remove.mockResolvedValue({ count: 1 }); mocks.exerciseCount.mockResolvedValue(1); });
describe('personal study plans', () => {
  it('creates an owned plan with normalized dates', async () => {
    const response = await create(request('study-plans', 'POST', body), {});
    expect(response.status).toBe(200); expect((await response.json()).data.contentTitle).toBe('课程');
    expect(mocks.create.mock.calls[0][0].data.ownerId).toBe('u1');
  });
  it('rejects inverted reminders, blank titles and out of range minutes', async () => {
    for (const changed of [{ remindAt: '2026-10-08T11:00:00Z' }, { title: ' ' }, { targetMinutes: 601 }]) {
      expect((await create(request('study-plans', 'POST', { ...body, ...changed }), {})).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('blocks foreign content even for administrators', async () => {
    mocks.content.mockResolvedValue({ ownerId: 'other' });
    expect((await create(request('study-plans', 'POST', body, 'admin'), {})).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('filters due plans by authenticated owner and incomplete status', async () => {
    expect((await plans(request('study-plans?due=true'), {})).status).toBe(200);
    expect(mocks.plans.mock.calls[0][0].where).toMatchObject({ ownerId: 'u1', completedAt: null, remindAt: { lte: expect.any(Date) } });
    expect((await plans(request('study-plans?pageSize=51'), {})).status).toBe(400);
  });
  it('completes, reopens and deletes only owned plans', async () => {
    await PATCH(request('study-plans/plan1', 'PATCH', { completed: true }), { params: { id: 'plan1' } });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: 'plan1', ownerId: 'u1' }, data: { completedAt: expect.any(Date) } });
    await PATCH(request('study-plans/plan1', 'PATCH', { completed: false }), { params: { id: 'plan1' } });
    expect(mocks.update.mock.calls[1][0].data.completedAt).toBeNull();
    await DELETE(request('study-plans/plan1', 'DELETE'), { params: { id: 'plan1' } });
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'plan1', ownerId: 'u1' } });
    mocks.update.mockResolvedValue({ count: 0 }); mocks.remove.mockResolvedValue({ count: 0 });
    expect((await PATCH(request('study-plans/foreign', 'PATCH', { completed: true }), { params: { id: 'foreign' } })).status).toBe(404);
    expect((await DELETE(request('study-plans/foreign', 'DELETE'), { params: { id: 'foreign' } })).status).toBe(404);
  });
});
describe('question bank', () => {
  const q = { id: 'e1', contentId: 'c1', pointId: 'p1', type: 'SINGLE_CHOICE', question: '问题', options: ['甲', '乙'], correctAnswer: 'A', explanation: '解析', content: { title: '课程' }, point: { title: '梯度' }, records: [] };
  it('never leaks unattempted answers and filters by owner and learner', async () => {
    mocks.exercises.mockResolvedValue([q]);
    const response = await exercises(request('exercises?status=unanswered&type=single_choice&contentId=c1&page=2'), {});
    const item = (await response.json()).data.items[0];
    expect(item).not.toHaveProperty('correctAnswer'); expect(item).not.toHaveProperty('explanation'); expect(item.latestRecord).toBeNull();
    expect(mocks.exercises.mock.calls[0][0]).toMatchObject({ skip: 10, where: { contentId: 'c1', content: { ownerId: 'u1' }, point: { ownerId: 'u1' }, records: { none: { learnerId: 'u1' } } }, include: { records: { where: { learnerId: 'u1' }, take: 1 } } });
  });
  it('returns the learner last attempted answer and supports historical wrong filter', async () => {
    mocks.exercises.mockResolvedValue([{ ...q, records: [{ userAnswer: 'B', correct: false, createdAt: new Date() }] }]);
    const response = await exercises(request('exercises?status=wrong'), {});
    expect((await response.json()).data.items[0].latestRecord.correctAnswer).toBe('A');
    expect(mocks.exercises.mock.calls[0][0].where.records).toEqual({ some: { learnerId: 'u1', correct: false } });
  });
  it('rejects unknown filters and page sizes', async () => {
    expect((await exercises(request('exercises?status=unknown'), {})).status).toBe(400);
    expect((await exercises(request('exercises?pageSize=51'), {})).status).toBe(400);
  });
  it('combines exact point filtering with owned content and retains answer hiding', async (): Promise<void> => {
    mocks.exercises.mockResolvedValue([q]);
    const response = await exercises(request('exercises?contentId=c1&pointId=p1'), {});
    expect(mocks.exercises.mock.calls[0][0].where).toMatchObject({ contentId: 'c1', pointId: 'p1', content: { ownerId: 'u1' }, point: { ownerId: 'u1' } });
    expect((await response.json()).data.items[0].latestRecord).toBeNull();
    expect((await exercises(request('exercises?pointId='), {})).status).toBe(400);
  });
});

