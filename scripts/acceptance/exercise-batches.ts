import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// Clone only knowledge points; no upload, queue, Ascend, or writes to the source account.
async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { PrismaClient } = await import('@prisma/client');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  const prisma = new PrismaClient();
  const sourceId = process.argv[2];
  assert.ok(sourceId, 'Provide an existing content ID');
  const destination = path.resolve(process.argv[3] ?? '.taskbook-working/exercise-batches/result.json');
  const ownerId = 'exercise-batches-' + randomUUID();
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), sourceId, scope: 'real Spark exercises from cloned existing knowledge points', status: 'running' };
  let ownerCreated = false;
  try {
    const source = await prisma.knowledgePoint.findMany({ where: { contentId: sourceId }, orderBy: { createdAt: 'asc' }, take: 20 });
    assert.ok(source.length, 'Source has knowledge points');
    const fingerprint = JSON.stringify(source);
    await prisma.user.create({ data: { id: ownerId, nickname: '题库分批隔离验收', passwordHash: 'disabled-isolated-account' } });
    ownerCreated = true;
    const content = await prisma.learningContent.create({ data: { ownerId, contentType: 'DOCUMENT', title: '题库隔离验收', fileName: 'test.txt', format: 'TXT', fileSizeBytes: 0n, storageKey: ownerId, status: 'READY', understandingStatus: 'COMPLETED' } });
    const pointIds: string[] = [];
    for (const point of source) {
      const cloned = await prisma.knowledgePoint.create({ data: { ownerId, contentId: content.id, title: point.title, summary: point.summary, importance: point.importance, tags: point.tags, refs: [] } });
      pointIds.push(cloned.id);
    }
    const token = signAccessToken({ sub: ownerId, email: null, role: 'student' });
    const base = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';
    async function call(route: string, body?: unknown): Promise<Record<string, unknown>> {
      const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(600_000) });
      const envelope = await response.json() as { success: boolean; data: Record<string, unknown>; error?: { code: string } };
      assert.ok(response.ok && envelope.success, `${route}: HTTP ${response.status} ${envelope.error?.code ?? ''}`);
      return envelope.data;
    }
    const started = Date.now();
    const generated = await call('/api/exercises/generate', { pointIds, count: 5 });
    report.durationMs = Date.now() - started;
    const questions = generated.questions as { exerciseId: string; correctAnswer?: string; explanation?: string }[];
    assert.equal(questions.length, 5);
    assert.ok(questions.every((question) => !('correctAnswer' in question) && !('explanation' in question)));
    const stored = await prisma.exercise.findMany({ where: { contentId: content.id }, select: { id: true, type: true, question: true, options: true, correctAnswer: true, explanation: true } });
    assert.equal(stored.length, 5);
    assert.equal(new Set(stored.map((q) => q.question.trim().toLocaleLowerCase())).size, 5);
    const answer = await call('/api/exercises/' + stored[0].id + '/answer', { userAnswer: stored[0].correctAnswer });
    assert.equal(answer.correct, true);
    assert.equal((await call('/api/exercises?contentId=' + content.id)).total, 5);
    assert.equal((await call('/api/exercises?contentId=' + content.id + '&status=unanswered')).total, 4);
    const after = await prisma.knowledgePoint.findMany({ where: { contentId: sourceId }, orderBy: { createdAt: 'asc' }, take: 20 });
    assert.equal(JSON.stringify(after), fingerprint);
    report.questions = stored.map(({ id, ...question }) => question);
    report.answersHidden = true; report.correctAnswerPassed = true; report.unansweredCount = 4; report.sourceUnchanged = true; report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error instanceof Error ? error.message : 'unknown'; process.exitCode = 1;
  } finally {
    if (ownerCreated) await prisma.user.delete({ where: { id: ownerId } });
    report.cleaned = true; report.finishedAt = new Date().toISOString();
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
    await prisma.$disconnect();
    console.log(JSON.stringify({ status: report.status, durationMs: report.durationMs, cleaned: report.cleaned }));
  }
}
void main().catch(() => { console.error('Exercise acceptance could not finish'); process.exitCode = 1; });
