import { loadEnvConfig } from '@next/env';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { exerciseSource } from '../../src/lib/domain/exercise-source';
import type { ApiSuccess, BankList, ContentSummary, Understanding } from '../../src/services/api';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputPath] = process.argv.slice(2);
  if (!contentId || !outputPath) throw new Error('用法：tsx scripts/acceptance/exercise-quality.ts <资料ID> <结果JSON路径>');
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    const snapshot = async (): Promise<string> => {
      const values = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: content.ownerId }, select: { xpTotal: true, updatedAt: true } }),
        prisma.exercise.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        prisma.exerciseRecord.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        prisma.mastery.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        prisma.learningProgress.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
      ]);
      return createHash('sha256').update(JSON.stringify(values)).digest('hex');
    };
    const before = await snapshot();
    const token = signAccessToken({ sub: content.ownerId, email: content.owner.email, role: content.owner.role });
    const read = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`http://localhost:3000${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) throw new Error(`只读接口 HTTP ${response.status}`);
      return ((await response.json()) as ApiSuccess<T>).data;
    };
    const [detail, understanding, stored] = await Promise.all([
      read<ContentSummary>(`/api/contents/${contentId}`), read<Understanding>(`/api/contents/${contentId}/understanding`),
      prisma.exercise.findMany({ where: { contentId }, orderBy: { id: 'asc' }, include: { point: true } }),
    ]);
    const bank: BankList['items'] = [];
    for (let page = 1; ; page += 1) {
      const result = await read<BankList>(`/api/exercises?contentId=${encodeURIComponent(contentId)}&pageSize=50&page=${page}`);
      bank.push(...result.items);
      if (page * result.pageSize >= result.total) break;
      if (!result.items.length) throw new Error('题库分页未推进');
    }
    if (!stored.length || bank.length !== stored.length) throw new Error('题库与存储数量不一致或没有题目');
    const questions = stored.map((question) => {
      if (question.point.ownerId !== content.ownerId) throw new Error('题目知识点归属不一致');
      const publicQuestion = bank.find((item) => item.exerciseId === question.id);
      if (!publicQuestion || 'correctAnswer' in publicQuestion || 'explanation' in publicQuestion) throw new Error('题目缺失或顶层答案泄露');
      const source = exerciseSource(detail, understanding, question.pointId);
      if (!source?.refs.length) throw new Error('缺少有效来源');
      if (question.type === 'SINGLE_CHOICE' && (!question.options.includes(question.correctAnswer) || new Set(question.options.map((item) => item.trim().toLocaleLowerCase())).size !== question.options.length)) throw new Error('选项与存储答案结构不一致');
      const evidence = source.refs.map((ref) => ({
        ref,
        transcripts: ref.type === 'video' ? understanding.transcriptSegments.filter((item) => Math.floor(item.startMs / 1000) === ref.timestampSec).map((item) => ({ startMs: item.startMs, endMs: item.endMs, text: item.text })) : [],
        // 原文的后续20秒仅供人工阅读上下文，不成为新的题目引用。
        followingTranscripts: ref.type === 'video' ? understanding.transcriptSegments.filter((item) => item.startMs >= (ref.timestampSec + 1) * 1000 && item.startMs < (ref.timestampSec + 21) * 1000).map((item) => ({ startMs: item.startMs, endMs: item.endMs, text: item.text })) : [],
        blocks: understanding.textBlocks.filter((item) => item.ref.type === ref.type && (ref.type === 'video' ? item.ref.type === 'video' && item.ref.timestampSec === ref.timestampSec : item.ref.type === 'document' && item.ref.page === ref.page && (ref.blockIndex === undefined || item.ref.blockIndex === ref.blockIndex))).map((item) => ({ ref: item.ref, text: item.text, source: item.source })),
      }));
      if (evidence.some((item) => !item.transcripts.length && !item.blocks.length)) throw new Error('引用没有对应原始来源');
      return { exerciseId: question.id, type: question.type, question: question.question, options: question.options, correctAnswer: question.correctAnswer, explanation: question.explanation, point: { title: source.title, summary: source.summary }, unattempted: publicQuestion.latestRecord === null, evidence };
    });
    const after = await snapshot();
    const unchanged = before === after;
    if (!unchanged) throw new Error('验收期间数据库记录改变，不能证明只读保持');
    const report = { verifiedAt: new Date().toISOString(), mode: 'read-only', contentId, checkedQuestions: questions.length, recordsUnchanged: unchanged, snapshotBefore: before, snapshotAfter: after, dataWritten: false, modelCalled: false, semanticQualityAutomaticallyVerified: false, questions };
    await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ checkedQuestions: questions.length, recordsUnchanged: unchanged, dataWritten: false, modelCalled: false }) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
