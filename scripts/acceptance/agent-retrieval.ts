import { loadEnvConfig } from '@next/env';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ApiSuccess, AgentResult } from '../../src/services/api';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [contentId, outputDirectory, mode = 'tools'] = process.argv.slice(2);
  if (!contentId || !outputDirectory || !['tools', 'model', 'diagnostic'].includes(mode)) throw new Error('用法：tsx scripts/acceptance/agent-retrieval.ts <30分钟演示资料ID> <新结果目录> [tools|model|diagnostic]');
  await mkdir(outputDirectory, { recursive: false });
  const save = async (name: string, value: unknown): Promise<void> => { await writeFile(`${outputDirectory}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' }); };
  const { prisma } = await import('../../src/lib/prisma');
  const { createToolState, executeAgentTool } = await import('../../src/lib/agent/tools');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, include: { owner: true } });
    if (content.contentType !== 'VIDEO' || content.durationSec !== 1800) throw new Error('本入口仅验收已解析的30分钟演示视频');
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
    const state = await createToolState(contentId, content.ownerId);
    const tool = await executeAgentTool(state, { action: 'search_material', query: '第七题情境分析原文' });
    const raw = await prisma.transcriptSegment.findMany({ where: { contentId, startMs: { gte: 520000, lte: 675000 } }, orderBy: { startMs: 'asc' }, select: { startMs: true, endMs: true, text: true } });
    await save('retrieval', { tool, evidence: state.evidence, points: state.points.map((point) => ({ title: point.title, refs: point.refs })), rawContext: raw });
    const joined = state.evidence.map((row) => row.excerpt).join('\n');
    const noGenericLocations = state.evidence.every((row) => row.ref.type === 'video' && row.ref.timestampSec >= 520 && row.ref.timestampSec <= 675);
    const containsDefence = /防空/.test(joined) && /一个|单一目标/.test(joined);
    const containsAttack = /饱和/.test(joined);
    const retrievalPassed = Boolean(state.evidence.length && noGenericLocations && containsDefence && containsAttack);
    const call = async (token: string | null, message: string): Promise<{ status: number; data?: AgentResult; code?: string }> => {
      const response = await fetch('http://127.0.0.1:3000/api/assistant/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ contentId, message, minutes: 20 }), signal: AbortSignal.timeout(105000) });
      const result = await response.json() as ApiSuccess<AgentResult> | { success: false; error: { code: string } };
      return result.success ? { status: response.status, data: result.data } : { status: response.status, code: result.error.code };
    };
    const report: Record<string, unknown> = { verifiedAt: new Date().toISOString(), mode, sourceCount: state.evidence.length, noGenericLocations, containsDefence, containsAttack, retrievalPassed, modelCalled: mode !== 'tools' && retrievalPassed, semanticQualityAutomaticallyVerified: false, semanticReviewRequired: mode !== 'tools' };
    if (mode === 'diagnostic' && retrievalPassed) {
      const { runLearningAgent } = await import('../../src/lib/agent/learning-agent');
      const { withAgentDiagnostics } = await import('../../src/lib/agent/model');
      const events: import('../../src/lib/agent/model').AgentModelDiagnostic[] = [];
      const startedAt = Date.now();
      try {
        const result = await withAgentDiagnostics(events, () => runLearningAgent({ contentId, message: '我有20分钟，请检索第七题的原文依据，解释来袭方与防御方的区别，挑选该知识点已有练习，返回不超过20分钟的复习方案。只解释原文能确认的内容，说明真实掌握记录。', minutes: 20, history: [] }, content.ownerId));
        await save('diagnostic', { result }); report.diagnosticSucceeded = true;
      } catch (reason: unknown) {
        // 本机忽略目录留诊断，普通控制台不输出模型原文或敏感输入。
        await save('diagnostic', { error: reason instanceof Error ? reason.message : '失败' }); report.diagnosticSucceeded = false;
      }
      await save('timings', { durationMs: Date.now() - startedAt, events });
    }
    if (mode === 'model' && retrievalPassed) {
      const token = signAccessToken({ sub: content.ownerId, email: content.owner.email, role: content.owner.role });
      const model = await call(token, '我有20分钟，请检索第七题的原文依据，解释来袭方与防御方的区别，挑选该知识点已有练习，返回不超过20分钟的复习方案。只解释原文能确认的内容，说明真实掌握记录。');
      await save('model', model);
      const anonymous = await call(null, '复习');
      const cross = await call(signAccessToken({ sub: `retrieval-outsider-${randomUUID()}`, email: null, role: 'admin' }), '复习');
      report.modelStatus = model.status; report.modelCode = model.code; report.anonymousStatus = anonymous.status; report.otherAdminStatus = cross.status;
      report.modelCitationsInTopic = model.data?.citations.length ? model.data.citations.every((row) => row.ref.type === 'video' && row.ref.timestampSec >= 520 && row.ref.timestampSec <= 675) : false;
      report.modelHasPracticeAndPlan = Boolean(model.data?.practice.length && model.data.plan && model.data.plan.targetMinutes <= 20);
      // HTTP/引用位置/方案成功不自动视为语义通过；人工核对model.json中的攻防主体。
    }
    report.protectedFingerprintBefore = before; report.protectedFingerprintAfter = await fingerprint(); report.recordsUnchanged = before === report.protectedFingerprintAfter;
    await save('report', report);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (!retrievalPassed || !report.recordsUnchanged || (mode === 'diagnostic' && !report.diagnosticSucceeded) || (mode === 'model' && (report.modelStatus !== 200 || report.anonymousStatus !== 401 || report.otherAdminStatus !== 403 || !report.modelCitationsInTopic || !report.modelHasPracticeAndPlan))) throw new Error('真实验收未全部通过，保留证据');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '验收失败') + '\n'); process.exitCode = 1; });
