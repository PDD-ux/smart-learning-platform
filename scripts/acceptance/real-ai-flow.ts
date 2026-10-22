import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '@next/env';
import { hashPassword } from '../../src/lib/auth/password';
import { cleanupContentObjects } from '../../src/lib/storage';
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
type Data = Record<string, unknown>;
type Question = { exerciseId: string; question: string; options: string[] };
async function main(): Promise<void> {
  if (!process.env.SPARK_API_PASSWORD) throw new Error('星火未配置，停止验收');
  const base = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';
  const runId = randomUUID();
  const ownerId = 'real-ai-acceptance-' + runId;
  const password = randomUUID();
  const account = ownerId + '@example.com';
  const result: Data = { runId, startedAt: new Date().toISOString(), provider: 'spark', model: process.env.SPARK_MODEL ?? 'lite', scope: '真实文本导入与星火学习闭环，不含 Ascend/ASR', status: 'running' };
  let token = '';
  let contentId: string | undefined;
  let pipelineSettled = true;
  async function call(route: string, method = 'GET', body?: unknown): Promise<Data> {
    const response = await fetch(base + '/api/' + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150000) });
    const envelope = await response.json() as { success: boolean; data: Data; error?: { code: string; message: string } };
    if (!response.ok || !envelope.success) throw new Error(route + ' HTTP ' + response.status + ' ' + (envelope.error?.code ?? 'INVALID_RESPONSE'));
    return envelope.data;
  }
  const reportDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '');
  const destination = path.resolve('docs/acceptance/real-ai-flow-' + reportDate + '-' + runId + '.json');
  try {
    await prisma.user.create({ data: { id: ownerId, email: account, nickname: '真实 AI 隔离验收', passwordHash: await hashPassword(password) } });
    token = String((await call('auth/login', 'POST', { account, password })).accessToken);
    const text = '# 梯度下降学习讲义\n\n梯度由函数对各变量的偏导数组成，指向函数增长最快的方向。为了最小化损失函数，梯度下降沿负梯度方向更新参数。\n\n更新公式：新参数 = 旧参数 - 学习率 × 梯度。学习率太大可能越过最小值，学习率太小则收敛缓慢。\n\n例如函数 f(x)=x² 的导数为 2x。当 x=3、学习率为0.1时，下一步 x=3-0.1×6=2.4。';
    const bytes = Buffer.from(text);
    const intent = await call('contents/upload-intent', 'POST', { contentType: 'document', fileName: 'gradient-real-ai.md', fileSize: bytes.length, mimeType: 'text/markdown' });
    contentId = String(intent.contentId); result.contentId = contentId;
    const upload = await fetch(new URL(String(intent.uploadUrl), base), { method: 'PUT', headers: { 'content-type': 'text/markdown' }, body: bytes, signal: AbortSignal.timeout(30000) });
    assert.equal(upload.status, 200, '预签名上传'); console.log('真实讲义上传成功');
    await call('contents/' + contentId + '/complete', 'POST', { size: bytes.length, title: '真实 AI 验收 · 梯度下降' });
    pipelineSettled = false;
    const deadline = Date.now() + 240000;
    let previous = '';
    while (Date.now() < deadline) {
      const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId } });
      const jobs = await prisma.asyncJob.findMany({ where: { contentId }, select: { jobType: true, state: true, stage: true, attempts: true } });
      const state = content.status + '/' + content.understandingStatus + '/' + jobs.map((job) => job.jobType + ':' + job.stage).join(',');
      if (state !== previous) { console.log(state); previous = state; }
      if (content.understandingStatus === 'COMPLETED' || content.status === 'FAILED' || (content.understandingStatus === 'FAILED' && jobs.every((job) => job.state !== 'PENDING' && job.state !== 'RUNNING'))) {
        pipelineSettled = true; result.jobs = jobs; result.contentStatus = content.status; result.understandingStatus = content.understandingStatus; break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(pipelineSettled, true, '流水线在 240 秒内结束');
    const understanding = await call('contents/' + contentId + '/understanding');
    const points = understanding.knowledgePoints as { pointId: string; title: string }[];
    const cards = await prisma.flashcard.findMany({ where: { contentId }, select: { id: true, front: true, back: true } });
    const note = await call('contents/' + contentId + '/generated-note');
    result.products = { knowledgePoints: points, flashcards: cards.map(({ front, back }) => ({ front, back })), generatedNote: note.note };
    assert.ok(points.length > 0, '必须实际生成知识点');
    assert.ok(cards.length > 0, '必须实际生成闪卡');
    assert.ok(note.note, '必须存在整理笔记');
    console.log('实际产物：知识点 ' + points.length + '，闪卡 ' + cards.length);
    const qa = await call('contents/' + contentId + '/ai/qa', 'POST', { question: '为什么梯度下降沿负梯度方向更新参数？请引用资料中的依据。' });
    result.qa = qa;
    assert.ok(String(qa.answer).trim().length > 0, 'AI 回答非空'); assert.ok((qa.citations as unknown[]).length > 0, 'AI 回答必须有引用');
    console.log('真实 AI 问答及引用通过');
    const generated = await call('exercises/generate', 'POST', { pointIds: points.slice(0, 20).map((point) => point.pointId), count: 2, type: 'single_choice' });
    const questions = generated.questions as Question[];
    assert.ok(questions.length > 0, '实际生成题目');
    assert.equal('correctAnswer' in questions[0], false, '作答前不可泄漏答案');
    result.questions = questions;
    const storedQuestions = await prisma.exercise.findMany({ where: { contentId }, select: { id: true, question: true, options: true, correctAnswer: true, explanation: true } });
    result.questionAudit = storedQuestions;
    const first = questions[0];
    const storedFirst = storedQuestions.find((question) => question.id === first.exerciseId);
    assert.ok(storedFirst, '必须读取本轮第一题的真实标准答案');
    const wrongOption = first.options.find((option) => option !== storedFirst.correctAnswer);
    assert.ok(wrongOption, '存在明确非标准答案的选项');
    const wrong = await call('exercises/' + first.exerciseId + '/answer', 'POST', { userAnswer: wrongOption });
    assert.equal(wrong.correct, false, '非标准选项必须判错');
    const wrongBank = await call('exercises?contentId=' + contentId + '&status=wrong');
    assert.equal(wrongBank.total, 1, '首次错答出现在错题筛选');
    const correct = await call('exercises/' + first.exerciseId + '/answer', 'POST', { userAnswer: String(wrong.correctAnswer) });
    assert.equal(correct.correct, true, '标准答案可重新作答判为正确');
    result.answers = [wrong, correct];
    const retriedBank = await call('exercises?contentId=' + contentId + '&status=wrong');
    const retriedItems = retriedBank.items as { exerciseId: string; latestRecord: { correct: boolean } }[];
    assert.equal(retriedBank.total, 1, '曾经答错筛选在重练后仍保留历史错题');
    assert.equal(retriedItems.find((item) => item.exerciseId === first.exerciseId)?.latestRecord.correct, true, '错题显示最近重练正确');
    const unanswered = await call('exercises?contentId=' + contentId + '&status=unanswered');
    assert.equal(unanswered.total, questions.length - 1, '已作答题从未作答筛选移除');
    result.bankChecks = { afterWrong: wrongBank.total, afterRetry: retriedBank.total, latestCorrect: true, unanswered: unanswered.total };
    const bank = await call('exercises?contentId=' + contentId);
    assert.equal(bank.total, questions.length, '题库真实题目持久化');
    result.bankTotal = bank.total;
    await call('flashcards/' + cards[0].id + '/review', 'POST', { rating: 3 });
    const graph = await call('contents/' + contentId + '/graph');
    result.graph = graph;
    assert.ok((graph.nodes as unknown[]).length > 0, '图谱包含真实生成知识点');
    const mastery = await prisma.mastery.findMany({ where: { learnerId: ownerId }, select: { score: true, correctRate: true, reviewCount: true } });
    result.mastery = mastery; assert.ok(mastery.length > 0, '练习与复习回写掌握度');
    result.status = 'passed';
    console.log('真实出题、题库判分、闪卡复习及图谱回写通过');
  } catch (error) {
    result.status = 'blocked'; result.failure = error instanceof Error ? error.message : '未知错误'; process.exitCode = 1;
    console.log('验收未通过：' + result.failure);
  } finally {
    if (pipelineSettled) {
      if (contentId) await cleanupContentObjects(contentId);
      await prisma.user.deleteMany({ where: { id: ownerId } });
      result.cleaned = true;
    } else { result.cleaned = false; result.pendingOwnerId = ownerId; }
    result.finishedAt = new Date().toISOString();
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
    await prisma.$disconnect();
    console.log('验收证据已保存，状态：' + result.status + '；清理：' + result.cleaned);
  }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '验收入口失败'); process.exitCode = 1; });

