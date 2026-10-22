import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { classCommandSchema, createClassSchema, joinClassSchema } from '@/lib/classrooms/contracts';
import { classBody, classPage, classHandlers } from '@/lib/classrooms/routes';
describe('classroom HTTP boundary', (): void => {
 it('requires explicit join consent and rejects role/owner injection', (): void => {
   const body = { requestId: crypto.randomUUID(), code: 'a'.repeat(22), confirmed: true };
   expect(joinClassSchema.safeParse(body).success).toBe(true);
   expect(joinClassSchema.safeParse({ ...body, confirmed: false }).success).toBe(false);
   expect(joinClassSchema.safeParse({ ...body, role: 'admin' }).success).toBe(false);
   expect(createClassSchema.safeParse({ requestId: body.requestId, title: '班级', description: '', responsibleId: 'other' }).success).toBe(false);
 });
 it('rejects unsupported submission actions and malformed version/time fields', (): void => {
   const body = { action: 'assignment', requestId: crypto.randomUUID(), expectedRevision: 1, title: '任务', instructions: '', chapterId: null, state: 'DRAFT', dueAt: null, publishConfirmed: false };
   expect(classCommandSchema.safeParse(body).success).toBe(true);
   for (const bad of [{ ...body, action: 'submit' }, { ...body, expectedRevision: 0 }, { ...body, dueAt: 'tomorrow' }, { ...body, score: 100 }, { ...body, instructions: '字'.repeat(20001) }]) expect(classCommandSchema.safeParse(bad).success).toBe(false);
 });
 it('accepts 20000 Chinese characters but bounds actual request bytes', async (): Promise<void> => {
   const req = (body: string): NextRequest => new NextRequest('http://local/api/classes', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
   expect(await classBody(req(JSON.stringify({ body: '字'.repeat(20000) })))).toEqual({ body: '字'.repeat(20000) });
   await expect(classBody(req(JSON.stringify({ body: '字'.repeat(45000) })))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
   await expect(classBody(req('{'))).rejects.toMatchObject({ code: 'INVALID_JSON' });
 });
 it('rejects ambiguous or unsupported pagination', (): void => {
   for (const query of ['page=0', 'page=1&page=2', 'role=admin', 'page=1.2', 'page=10000']) expect(() => classPage(new NextRequest('http://local/api/classes?' + query))).toThrow();
   expect(classPage(new NextRequest('http://local/api/classes?page=2'))).toBe(2);
 });
 it('keeps anonymous responses private and does not call the database', async (): Promise<void> => {
   const handlers = classHandlers();
   for (const action of [handlers.GET, handlers.POST, handlers.JOIN]) { const response = await action(new NextRequest('http://local/api/classes')); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie, Authorization'); }
 });
});
