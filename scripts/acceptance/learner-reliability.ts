import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '@next/env';
import { hashPassword } from '../../src/lib/auth/password';
import { api } from '../../src/services/api';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
const fixturePath = '.taskbook-working/learner-reliability-ui.json';
const nativeFetch = globalThis.fetch;
async function main(): Promise<void> {
  if (process.argv.includes('--cleanup-ui')) {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { id: string };
    assert.match(fixture.id, /^learner-audit-[a-f0-9-]{36}$/);
    await db.user.deleteMany({ where: { id: fixture.id } }); await unlink(fixturePath);
    console.log(JSON.stringify({ temporaryFixtureCleaned: true })); return;
  }
  const base = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';
  assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base), 'only local demo acceptance');
  const run = randomUUID(); const id = 'learner-audit-' + run; const otherId = 'learner-other-' + run;
  const account = id + '@example.com'; const password = randomUUID() + '!Aa9';
  let keep = false;
  try {
    const passwordHash = await hashPassword(password);
    await db.user.createMany({ data: [{ id, email: account, nickname: '用户端隔离验收', passwordHash }, { id: otherId, email: otherId + '@example.com', nickname: '隔离用户', passwordHash }] });
    async function signIn(email: string): Promise<string> {
      const response = await nativeFetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: email, password }) });
      assert.equal(response.status, 200); return (await response.json() as { data: { accessToken: string } }).data.accessToken;
    }
    const token = await signIn(account); const otherToken = await signIn(otherId + '@example.com');
    const ids = Array.from({ length: 55 }, (_, i) => 'audit-content-' + run + '-' + i);
    await db.learningContent.createMany({ data: ids.map((contentId, i) => ({ id: contentId, ownerId: id, contentType: 'DOCUMENT', title: '隔离资料 ' + i, fileName: 'fixture.txt', format: 'TXT', fileSizeBytes: BigInt(0), storageKey: 'audit-no-object/' + contentId, status: 'READY', understandingStatus: 'NONE', pageCount: 1, createdAt: new Date(Date.now() - i * 1000) })) });
    await db.flashcard.createMany({ data: Array.from({ length: 56 }, (_, i) => ({ id: 'audit-card-' + run + '-' + i, ownerId: id, contentId: ids[0], front: '人工测试问题 ' + i, back: '人工测试答案', nextReviewAt: new Date(Date.now() + (i === 55 ? 86400000 : -60000)) })) });
    globalThis.fetch = async (input, init): Promise<Response> => {
      const headers = new Headers(init?.headers); headers.set('authorization', 'Bearer ' + token);
      return nativeFetch(new URL(String(input), base), { ...init, headers });
    };
    const contents = await api.contents(); assert.equal(contents.items.length, 55); assert.equal(new Set(contents.items.map((item) => item.contentId)).size, 55);
    assert.ok(contents.items.some((item) => item.title === '隔离资料 54'));
    const cards = await api.flashcards(true, ids[0]); assert.equal(cards.items.length, 55); assert.equal(cards.total, 55);
    assert.equal((await api.flashcards(false, ids[0])).total, 56);
    const changed = await api.updateContent(ids[54], '已改名的隔离资料'); assert.equal(changed.title, '已改名的隔离资料');
    async function denied(method: 'PATCH' | 'DELETE'): Promise<void> {
      const response = await nativeFetch(base + '/api/contents/' + ids[54], { method, headers: { authorization: 'Bearer ' + otherToken, 'content-type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ title: '越权改名' }) } : {}) });
      assert.equal(response.status, 403);
    }
    await denied('PATCH'); await denied('DELETE');
    const point = await db.knowledgePoint.create({ data: { ownerId: id, contentId: ids[54], title: '人工知识点', summary: '测试级联', importance: 3, refs: [] } });
    const exercise = await db.exercise.create({ data: { contentId: ids[54], pointId: point.id, type: 'SHORT_ANSWER', question: '人工测试题', correctAnswer: '答案', explanation: '人工解析', options: [] } });
    await db.exerciseRecord.create({ data: { exerciseId: exercise.id, learnerId: id, userAnswer: '答案', correct: true, masteryDelta: 0 } });
    await db.note.create({ data: { ownerId: id, contentId: ids[54], content: '人工笔记', ref: { type: 'document', page: 1 } } });
    await db.learningPlan.create({ data: { ownerId: id, contentId: ids[54], title: '人工计划', targetMinutes: 10, scheduledAt: new Date(), remindAt: new Date() } });
    await api.deleteContent(ids[54]);
    assert.equal(await db.learningContent.count({ where: { id: ids[54] } }), 0);
    assert.equal(await db.note.count({ where: { contentId: ids[54] } }), 0);
    assert.equal(await db.learningPlan.count({ where: { contentId: ids[54] } }), 0);
    assert.equal(await db.exerciseRecord.count({ where: { exerciseId: exercise.id } }), 0);
    const evidence = { time: new Date().toISOString(), realHttpPostgresqlAndClientService: true, artificialFixtures: true, externalAiCalls: 0, contentsBeyond50: true, dueCardsBeyond50: true, futureCardsExcluded: true, contentRenamePassed: true, foreignRenameAndDeleteRejected: true, contentDeletionAndCascadePassed: true, realUserDataChanged: false, originalFaceTemplateChanged: false };
    await writeFile('docs/acceptance/learner-reliability-20261009.json', JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify(evidence));
    if (process.argv.includes('--keep-ui')) { await mkdir('.taskbook-working', { recursive: true }); await writeFile(fixturePath, JSON.stringify({ id, account, password })); keep = true; }
  } finally {
    globalThis.fetch = nativeFetch;
    if (!keep) await db.user.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: otherId } });
  }
}
void main().catch((): void => { console.error('用户端隔离验收失败，不输出凭据或原始响应'); process.exitCode = 1; }).finally(async (): Promise<void> => { await db.$disconnect(); });
