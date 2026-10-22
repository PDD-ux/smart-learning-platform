import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
const m=vi.hoisted((): {transaction: ReturnType<typeof vi.fn>} => ({transaction:vi.fn()}));
vi.mock('@/lib/prisma',(): object => ({prisma:{$transaction:m.transaction}}));
import { signAccessToken } from '@/lib/auth/jwt';
import { GET, POST } from '@/app/api/courses/[id]/discussions/route';
import { PATCH as patchThread } from '@/app/api/discussions/[id]/route';
import { GET as replies, POST as reply } from '@/app/api/discussions/[id]/replies/route';
import { PATCH as patchReply } from '@/app/api/discussion-replies/[id]/route';
afterEach((): void => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each([
  ['invalid list',GET,'GET','?page=0'], ['invalid create',POST,'POST',''],
  ['invalid edit',patchThread,'PATCH',''], ['invalid replies',replies,'GET','?page=0'],
  ['invalid reply',reply,'POST',''], ['invalid reply edit',patchReply,'PATCH',''],
] as const)('makes the closed release gate precede %s validation', async (_name, handler, method, query): Promise<void> => {
  vi.stubEnv('DISCUSSION_RELEASE_READY','false');
  const token=signAccessToken({sub:'gate-test',email:'gate@example.test',role:'student'});
  const request=new NextRequest('http://localhost/api/test'+query,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='GET'?{}:{body:'invalid JSON'})});
  const result=await handler(request,{params:{id:'550e8400-e29b-41d4-a716-446655440000'}});
  expect(result.status).toBe(404);expect(result.headers.get('cache-control')).toBe('private, no-store');expect(m.transaction).not.toHaveBeenCalled();
});
