import { loadEnvConfig } from '@next/env';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ApiSuccess, AgentResult } from '../../src/services/api';
loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputDirectory, mode = 'readonly'] = process.argv.slice(2);
  if (!contentId || !outputDirectory || !['readonly', 'feedback', 'diagnostic'].includes(mode)) throw new Error('用法：tsx scripts/acceptance/learning-agent.ts <本人资料ID> <结果目录> [readonly|feedback|diagnostic]');
  await mkdir(outputDirectory, { recursive: true });
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  let temporaryOwner = '';
  const snapshot = async (ownerId: string): Promise<string> => {
    const values = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { xpTotal: true } }),
      prisma.learningContent.findMany({ where: { ownerId }, orderBy: { id: 'asc' }, select: { id: true, title: true, status: true, understandingStatus: true } }),
      prisma.note.findMany({ where: { ownerId }, orderBy: { id: 'asc' } }),
      prisma.mastery.findMany({ where: { learnerId: ownerId }, orderBy: { id: 'asc' } }),
      prisma.exerciseRecord.findMany({ where: { learnerId: ownerId }, orderBy: { id: 'asc' } }),
      prisma.learningPlan.findMany({ where: { ownerId }, orderBy: { id: 'asc' } }),
    ]);
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
  };
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    const before = await snapshot(content.ownerId);
    if (mode === 'diagnostic') {
      const { runLearningAgent } = await import('../../src/lib/agent/learning-agent');
      try {
        const result = await runLearningAgent({ contentId, message: '根据学习记录，检索原文，推荐练习和20分钟复习计划。', minutes: 20, history: [] }, content.ownerId);
        await writeFile(`${outputDirectory}/diagnostic.json`, JSON.stringify({ result, recordsUnchanged: before === await snapshot(content.ownerId) }, null, 2));
      } catch (reason: unknown) {
        await writeFile(`${outputDirectory}/diagnostic.json`, JSON.stringify({ error: reason instanceof Error ? reason.message : '分析失败', recordsUnchanged: before === await snapshot(content.ownerId) }, null, 2));
      }
      return;
    }
    const ownerToken = signAccessToken({ sub: content.ownerId, email: content.owner.email, role: content.owner.role });
    const call = async <T,>(path: string, token: string | null, body: unknown): Promise<{ status: number; data?: T; code?: string }> => {
      const response = await fetch(`http://127.0.0.1:3000${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(105_000) });
      const result = await response.json() as ApiSuccess<T> | { success: false; error: { code: string } };
      return result.success ? { status: response.status, data: result.data } : { status: response.status, code: result.error.code };
    };
    const startedAt = Date.now();
    const own = mode === 'readonly' ? await call<AgentResult>('/api/assistant/agent', ownerToken, { contentId, message: '我有20分钟，请根据我的真实学习记录安排复习：检索资料中的原文依据，挑选已有练习，并给出可执行的复习方案。未作答时不要断言已掌握或薄弱。', minutes: 20, history: [] }) : null;
    if (own) await writeFile(`${outputDirectory}/owner-result.json`, JSON.stringify(own, null, 2));
    const report: Record<string, unknown> = { verifiedAt: new Date().toISOString(), mode, ownerModelCalled: own !== null, ownerStatus: own?.status, ownerCode: own?.code, ownerElapsedMs: Date.now() - startedAt, tools: own?.data?.steps, citationCount: own?.data?.citations.length, practiceCount: own?.data?.practice.length, planMinutes: own?.data?.plan?.targetMinutes };
    if (own && (own.status !== 200 || !own.data?.steps.some((step) => step.tool === 'learning_status'))) throw new Error(`真实Agent失败 HTTP ${own.status} ${own.code ?? ''}`);
    const anonymous = await call('/api/assistant/agent', null, { contentId, message: '复习' });
    const otherToken = signAccessToken({ sub: `agent-outsider-${randomUUID()}`, email: null, role: 'admin' });
    const cross = await call('/api/assistant/agent', otherToken, { contentId, message: '复习' });
    report.anonymousStatus = anonymous.status; report.otherAdminStatus = cross.status;
    if (anonymous.status !== 401 || cross.status !== 403) throw new Error('鉴权/归属验收未通过');
    if (mode === 'feedback') {
      const user = await prisma.user.create({ data: { nickname: 'Agent隔离验收', passwordHash: 'unusable-test-hash' } }); temporaryOwner = user.id;
      await writeFile(`${outputDirectory}/fixture.json`, JSON.stringify({ ownerId: user.id, createdAt: user.createdAt.toISOString(), purpose: '仅本脚本的隔离验收记录', cleanup: false }, null, 2));
      const token = signAccessToken({ sub: user.id, email: null, role: 'student' });
      const lesson = await prisma.learningContent.create({ data: { ownerId: user.id, title: '链式法则隔离验收', contentType: 'VIDEO', fileName: 'agent-test.mp4', format: 'MP4', fileSizeBytes: BigInt(0), storageKey: `acceptance/agent/${randomUUID()}`, durationSec: 120, status: 'READY', understandingStatus: 'COMPLETED' } });
      const point = await prisma.knowledgePoint.create({ data: { ownerId: user.id, contentId: lesson.id, title: '链式法则', summary: '复合函数的导数由各层局部导数相乘。', importance: 5, tags: [], refs: [{ type: 'video', timestampSec: 10 }] } });
      await prisma.transcriptSegment.create({ data: { contentId: lesson.id, seq: 0, startMs: 10000, endMs: 15000, text: '链式法则用于计算复合函数的导数，各层局部导数相乘。反向传播利用链式法则逐层计算梯度。' } });
      const exercise = await prisma.exercise.create({ data: { contentId: lesson.id, pointId: point.id, type: 'SINGLE_CHOICE', question: '反向传播使用什么法则逐层计算梯度？', options: ['链式法则', '任意相加'], correctAnswer: 'A', explanation: '依据10秒原文，反向传播利用链式法则。' } });
      const initial = await call<AgentResult>('/api/assistant/agent', token, { contentId: lesson.id, message: '请读取真实学习记录、检索链式法则原文、推荐练习和10分钟复习方案。', minutes: 10 });
      await writeFile(`${outputDirectory}/initial.json`, JSON.stringify(initial, null, 2));
      if (initial.status !== 200) {
        const { runLearningAgent } = await import('../../src/lib/agent/learning-agent');
        try { await writeFile(`${outputDirectory}/initial-diagnostic.json`, JSON.stringify({ result: await runLearningAgent({ contentId: lesson.id, message: '请读取真实学习记录、检索链式法则原文、推荐练习和10分钟复习方案。', minutes: 10, history: [] }, user.id) }, null, 2)); }
        catch (reason: unknown) { await writeFile(`${outputDirectory}/initial-diagnostic.json`, JSON.stringify({ error: reason instanceof Error ? reason.message : '失败' }, null, 2)); }
      }
      if (initial.status !== 200 || !initial.data?.practice.length || !initial.data.plan) throw new Error('隔离初始Agent闭环失败');
      const answer = await call<{ correct: boolean }>('/api/exercises/' + exercise.id + '/answer', token, { userAnswer: 'B' });
      if (answer.status !== 200 || answer.data?.correct !== false) throw new Error('隔离真实判分失败');
      const afterAnswer = await call<AgentResult>('/api/assistant/agent', token, { contentId: lesson.id, message: '请重新读取我的真实作答及掌握记录，分析待巩固知识点，给出原文依据与调整后的复习方案。', minutes: 10 });
      await writeFile(`${outputDirectory}/after-answer.json`, JSON.stringify(afterAnswer, null, 2));
      if (afterAnswer.status !== 200) {
        const { runLearningAgent } = await import('../../src/lib/agent/learning-agent');
        try { await writeFile(`${outputDirectory}/after-answer-diagnostic.json`, JSON.stringify({ result: await runLearningAgent({ contentId: lesson.id, message: '请重新读取我的真实作答及掌握记录，分析待巩固知识点，给出原文依据与调整后的复习方案。', minutes: 10, history: [] }, user.id) }, null, 2)); }
        catch (reason: unknown) { await writeFile(`${outputDirectory}/after-answer-diagnostic.json`, JSON.stringify({ error: reason instanceof Error ? reason.message : '失败' }, null, 2)); }
      }
      if (afterAnswer.status !== 200 || !afterAnswer.data?.steps.some((step) => step.tool === 'learning_status' && step.summary.includes('最近1次作答'))) throw new Error('Agent未读取新作答');
      const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
      const plan = await call('/api/study-plans', token, { contentId: lesson.id, title: initial.data.plan.title, targetMinutes: initial.data.plan.targetMinutes, scheduledAt, remindAt: scheduledAt });
      if (plan.status !== 200 || await prisma.learningPlan.count({ where: { ownerId: user.id } }) !== 1) throw new Error('隔离计划保存失败');
      await writeFile(`${outputDirectory}/isolated-feedback.json`, JSON.stringify({ initial, answer, afterAnswer, planStatus: plan.status }, null, 2));
      report.isolatedFeedbackVerified = true; report.isolatedPlanSaved = true;
    }
    report.protectedFingerprintBefore = before; report.protectedFingerprintAfter = await snapshot(content.ownerId); report.ownerRecordsUnchanged = before === report.protectedFingerprintAfter;
    if (!report.ownerRecordsUnchanged) throw new Error('本人保护记录改变，不能宣称保持');
    await writeFile(`${outputDirectory}/report.json`, JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report) + '\n');
  } finally {
    if (temporaryOwner) { await prisma.user.delete({ where: { id: temporaryOwner } }); await writeFile(`${outputDirectory}/cleanup.json`, JSON.stringify({ ownerId: temporaryOwner, removed: await prisma.user.count({ where: { id: temporaryOwner } }) === 0 }, null, 2)); }
    await prisma.$disconnect();
  }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
