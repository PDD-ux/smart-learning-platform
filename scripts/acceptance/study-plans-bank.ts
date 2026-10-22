import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '@next/env';
import { hashPassword } from '../../src/lib/auth/password';
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
type Envelope = { success: boolean; data: Record<string, unknown> };
async function main(): Promise<void> {
  const base = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';
  const run = randomUUID();
  const ownerId = 'acceptance-' + run;
  const otherId = 'other-' + run;
  let checks = 0;
  const password = randomUUID();
  const tokens: string[] = [];
  async function call(path: string, method = 'GET', body?: unknown, other = false, status = 200): Promise<Record<string, unknown>> {
    const token = tokens[other ? 1 : 0];
    const response = await fetch(base + '/api/' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, path + ' HTTP status'); checks++;
    const envelope = await response.json() as Envelope;
    return envelope.data;
  }
  try {
    const passwordHash = await hashPassword(password);
    const accounts = [ownerId + '@example.com', otherId + '@example.com'];
    await prisma.user.createMany({ data: [{ id: ownerId, email: accounts[0], nickname: '临时验收', passwordHash }, { id: otherId, email: accounts[1], nickname: '临时隔离验收', passwordHash, role: 'admin' }] });
    for (const account of accounts) {
      const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }) });
      assert.equal(response.status, 200, 'temporary account login'); checks++;
      const envelope = await response.json() as Envelope;
      tokens.push(String(envelope.data.accessToken));
    }
    const content = await prisma.learningContent.create({ data: { ownerId, contentType: 'DOCUMENT', title: '隔离验收资料', fileName: 'acceptance.txt', format: 'TXT', fileSizeBytes: BigInt(0), storageKey: 'acceptance-no-object/' + run, status: 'READY', understandingStatus: 'COMPLETED' } });
    const point = await prisma.knowledgePoint.create({ data: { contentId: content.id, ownerId, title: '梯度', summary: '梯度由偏导数组成', tags: [], importance: 3, refs: [] } });
    const q = await prisma.exercise.create({ data: { contentId: content.id, pointId: point.id, type: 'SINGLE_CHOICE', question: '梯度由什么组成？', options: ['偏导数', '常量'], correctAnswer: '偏导数', explanation: '偏导数组成梯度' } });
    const planBody = { contentId: content.id, title: '复习梯度', targetMinutes: 20, scheduledAt: new Date().toISOString(), remindAt: new Date(Date.now() - 60000).toISOString() };
    const plan = await call('study-plans', 'POST', planBody);
    const id = String(plan.planId);
    const due = await call('study-plans?due=true'); assert.equal(due.total, 1); checks++;
    await call('study-plans', 'POST', planBody, true, 403);
    await call('study-plans/' + id, 'PATCH', { completed: true }, true, 404);
    await call('study-plans/' + id, 'PATCH', { completed: true });
    assert.equal((await call('study-plans?due=true')).total, 0); checks++;
    await call('study-plans/' + id, 'PATCH', { completed: false });
    const bank = await call('exercises?status=unanswered');
    const item = (bank.items as Record<string, unknown>[])[0];
    assert.equal(item.latestRecord, null); assert.equal('correctAnswer' in item, false); checks += 2;
    assert.equal((await call('exercises', 'GET', undefined, true)).total, 0); checks++;
    assert.equal((await call('exercises/' + q.id + '/answer', 'POST', { userAnswer: 'B' })).correct, false); checks++;
    assert.equal((await call('exercises?status=wrong')).total, 1); checks++;
    assert.equal((await call('exercises/' + q.id + '/answer', 'POST', { userAnswer: 'A' })).correct, true); checks++;
    assert.equal((await call('exercises?status=unanswered')).total, 0); checks++;
    await call('study-plans/' + id, 'DELETE', undefined, true, 404);
    await call('study-plans/' + id, 'DELETE');
    console.log(JSON.stringify({ status: 'passed', checks, database: 'real PostgreSQL', externalAiCalls: 0 }));
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '验收失败'); process.exitCode = 1; });

