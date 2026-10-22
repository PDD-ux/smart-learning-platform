import { loadEnvConfig } from '@next/env';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputDirectory, mode = 'replay', additionalSamples] = process.argv.slice(2);
  if (!contentId || !outputDirectory || !['replay', 'guard', 'evidence'].includes(mode)) throw new Error('用法：tsx scripts/acceptance/agent-faithfulness.ts <30分钟资料ID> <新证据目录> [replay|guard|evidence]');
  if (additionalSamples && mode !== 'replay') throw new Error('附加样本只用于replay');
  await mkdir(outputDirectory, { recursive: false });
  const save = async (name: string, data: unknown): Promise<void> => { await writeFile(`${outputDirectory}/${name}.json`, JSON.stringify(data, null, 2), { flag: 'wx' }); };
  const { prisma } = await import('../../src/lib/prisma');
  const { createToolState, executeAgentTool } = await import('../../src/lib/agent/tools');
  const { agentAnswerSchema } = await import('../../src/lib/agent/contracts');
  const { quoteIssues, reviewAnswer } = await import('../../src/lib/agent/faithfulness');
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId } });
    if (content.contentType !== 'VIDEO' || content.durationSec !== 1800) throw new Error('仅验收原30分钟演示视频');
    const fingerprint = async (): Promise<string> => {
      const protectedData = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: content.ownerId }, select: { xpTotal: true } }),
        prisma.learningContent.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' }, select: { id: true, title: true, status: true, understandingStatus: true } }),
        prisma.note.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        prisma.mastery.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        prisma.exerciseRecord.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        prisma.learningPlan.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        prisma.generatedNote.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        prisma.knowledgePoint.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        prisma.transcriptSegment.findMany({ where: { contentId }, orderBy: { seq: 'asc' } }),
        prisma.textBlock.findMany({ where: { contentId }, orderBy: { sequence: 'asc' } }),
      ]);
      return createHash('sha256').update(JSON.stringify(protectedData)).digest('hex');
    };
    const before = await fingerprint();
    const outcomes: Array<{ name: string; expected: 'rejected' | 'supported'; verdict?: string; errorCode?: string; quoteRejected?: boolean }> = [];
    let guardPassed = false;
    let expectedSampleCount = additionalSamples ? Infinity : 4;
    try {
      if (mode === 'guard' || mode === 'evidence') {
        const { signAccessToken } = await import('../../src/lib/auth/jwt');
        const owner = await prisma.user.findUniqueOrThrow({ where: { id: content.ownerId }, select: { email: true, role: true } });
        const call = async (token: string | null): Promise<{ status: number; body: unknown }> => {
          const response = await fetch('http://127.0.0.1:3000/api/assistant/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ contentId, message: '解释第七题原文，并给出复习方案', minutes: 20 }), signal: AbortSignal.timeout(105000) });
          return { status: response.status, body: await response.json() as unknown };
        };
        const authenticated = await call(signAccessToken({ sub: content.ownerId, ...owner }));
        const anonymous = await call(null);
        const cross = await call(signAccessToken({ sub: `faithfulness-outsider-${randomUUID()}`, email: null, role: 'admin' }));
        if (mode === 'guard') {
          const body = z.object({ success: z.literal(false), error: z.object({ code: z.literal('AI_UNAVAILABLE'), message: z.string() }) }).safeParse(authenticated.body);
          guardPassed = authenticated.status === 503 && body.success && body.data.error.message.includes('核验尚未通过') && !('data' in (authenticated.body as object)) && anonymous.status === 401 && cross.status === 403;
        } else {
          const body = z.object({ success: z.literal(true), data: z.object({ contentId: z.literal(contentId), answer: z.string(), citations: z.array(z.object({ ref: z.unknown(), excerpt: z.string() })), practice: z.array(z.object({ exerciseId: z.string(), contentId: z.literal(contentId) })), plan: z.object({ targetMinutes: z.number(), steps: z.array(z.object({ minutes: z.number().int().positive() })) }) }) }).safeParse(authenticated.body);
          const state = await createToolState(contentId, content.ownerId);
          await executeAgentTool(state, { action: 'search_material', query: '第七题情境分析原文' });
          const actualIds = await prisma.exercise.findMany({ where: { contentId, content: { ownerId: content.ownerId } }, select: { id: true } });
          const citationMatch = body.success && body.data.data.citations.length > 0 && body.data.data.citations.every((citation) => state.evidence.some((source) => JSON.stringify(source.ref) === JSON.stringify(citation.ref) && source.excerpt === citation.excerpt));
          const snippets = body.success ? [...body.data.data.answer.matchAll(/原文摘录 \d+：\n([^\n]+)(?=\n\n|$)/gu)].map((match) => match[1]) : [];
          const literalSnippets = snippets.length > 0 && snippets.every((snippet) => state.evidence.some((source) => source.excerpt.replace(/\s+/gu, ' ').trim().includes(snippet)));
          guardPassed = authenticated.status === 200 && body.success && body.data.data.answer.startsWith('证据模式：') && body.data.data.answer.includes('未通过核验') && citationMatch && literalSnippets && body.data.data.practice.length > 0 && body.data.data.practice.every((question) => actualIds.some((row) => row.id === question.exerciseId)) && body.data.data.plan.targetMinutes <= 20 && body.data.data.plan.steps.reduce((sum, step) => sum + step.minutes, 0) === body.data.data.plan.targetMinutes && anonymous.status === 401 && cross.status === 403;
        }
        await save(mode, { authenticated, anonymousStatus: anonymous.status, otherAdminStatus: cross.status, guardPassed });
      } else {
      const state = await createToolState(contentId, content.ownerId);
      const status = await executeAgentTool(state, { action: 'learning_status' });
      const learning = z.object({ points: z.array(z.object({ pointNumber: z.number(), title: z.string(), score: z.number().nullable(), isWeak: z.boolean().nullable(), recentAttempts: z.number(), recentWrong: z.number() })), recentAttemptCount: z.number(), dueFlashcards: z.number(), unfinishedPlans: z.number() }).parse(status.observation);
      await executeAgentTool(state, { action: 'search_material', query: '第七题情境分析原文' });
      if (state.evidence.length !== 1) throw new Error('实际来源与原错误样本条件不一致，停止');
      const sources = state.evidence.map((source, index) => ({ sourceId: index + 1, excerpt: source.excerpt }));
      const quote = '只能让命中单一目标的防空导弹，';
      if (!sources[0].excerpt.includes(quote)) throw new Error('正例摘引必须存在于实际原文');
      await save('evidence', { sources, learning });
      const cases: Array<{ name: string; expected: 'rejected' | 'supported'; candidate: z.infer<typeof agentAnswerSchema> }> = [];
      for (const name of ['model-final', 'model-subject']) {
        const path = `.taskbook-working/agent-retrieval-20261010-${name}/model.json`;
        const historical = z.object({ status: z.literal(200), data: z.object({ contentId: z.literal(contentId), answer: z.string(), citations: z.array(z.object({ ref: z.unknown(), excerpt: z.string() })) }) }).parse(JSON.parse(await readFile(path, 'utf8')));
        if (JSON.stringify(historical.data.citations) !== JSON.stringify(state.evidence)) throw new Error('旧引用与当前原文不同，停止');
        cases.push({ name, expected: 'rejected', candidate: agentAnswerSchema.parse({ answer: historical.data.answer, sourceIds: [1] }) });
      }
      cases.push({ name: 'real-quote-wrong-explanation', expected: 'rejected', candidate: agentAnswerSchema.parse({ answer: `原文：“${quote}”。${cases[0].candidate.answer}`, sourceIds: [1] }) });
      cases.push({ name: 'literal-positive-control', expected: 'supported', candidate: agentAnswerSchema.parse({ answer: `原文：“${quote}”。以上仅展示这一句原文，代词与噪声仍需结合视频核对，建议先回看资料。`, sourceIds: [1] }) });
      if (additionalSamples) {
        const localPath = resolve(additionalSamples);
        const withinEvidence = relative(resolve('.taskbook-working'), localPath);
        if (withinEvidence.startsWith('..') || isAbsolute(withinEvidence) || !localPath.endsWith('.json')) throw new Error('附加样本必须是.taskbook-working内的JSON文件');
        const extra = z.array(z.object({ name: z.string().regex(/^[a-z0-9-]{1,60}$/), expected: z.enum(['rejected', 'supported']), candidate: agentAnswerSchema })).min(1).max(4).parse(JSON.parse(await readFile(localPath, 'utf8')));
        if (new Set([...cases, ...extra].map((sample) => sample.name)).size !== cases.length + extra.length || extra.some((sample) => sample.candidate.sourceIds.some((id) => id !== 1))) throw new Error('附加样本不能重名或引用非本轮来源');
        cases.push(...extra);
        expectedSampleCount = cases.length;
      }
      for (const sample of cases) {
        try {
          // 故意单独回放语义审查，避免缺少引号提前拦截掩盖主体错误漏检。
          const review = await reviewAnswer({ candidate: sample.candidate, sources, learning, exercises: [] }, { timeoutMs: 20000, traceId: `faithfulness-${sample.name}` });
          const deterministicIssues = quoteIssues(sample.candidate.answer, sources);
          await save(sample.name, { ...sample, review, deterministicIssues });
          outcomes.push({ name: sample.name, expected: sample.expected, verdict: review.verdict, quoteRejected: Boolean(deterministicIssues.length) });
        } catch (reason: unknown) {
          const code = reason instanceof Error && 'code' in reason ? String(reason.code) : 'UNKNOWN';
          await save(sample.name, { ...sample, errorCode: code, error: reason instanceof Error ? reason.message : '验收失败' });
          outcomes.push({ name: sample.name, expected: sample.expected, errorCode: code });
        }
      }
      }
    } finally {
      const after = await fingerprint();
      const replayPassed = outcomes.length === expectedSampleCount && outcomes.every((row) => !row.errorCode && (row.expected === 'supported' ? row.verdict === 'supported' : row.verdict === 'contradicted' || row.verdict === 'insufficient'));
      const report = { verifiedAt: new Date().toISOString(), mode, outcomes, replayPassed, guardPassed, protectedFingerprintBefore: before, protectedFingerprintAfter: after, recordsUnchanged: before === after, semanticQualityUniversallyGuaranteed: false };
      await save('report', report); process.stdout.write(JSON.stringify(report) + '\n');
      if (!(mode !== 'replay' ? guardPassed : replayPassed) || !report.recordsUnchanged) throw new Error('错误样本回放/正例或保护验收未通过，保留证据');
    }
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
