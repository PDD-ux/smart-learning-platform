import { loadEnvConfig } from '@next/env';
import type { KnowledgePoint, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';

loadEnvConfig(process.cwd());
const contentId = 'cmuqhyf7h00027q29tijy4uer';
const replacements = [
  { id: 'cmus1vgzz000azpojzbkf5fvj', title: '第七题情境分析', summary: '讲解通过饱和袭击情境分析填空：来袭方可以实施饱和袭击，而只能命中单一目标的防空导弹难以单独应对多个目标。应明确区分来袭方与防御方，不能把命中单一目标理解为发动饱和袭击。' },
  { id: 'cmus1vh02000izpojhyn27nno', title: '中国科技观念辨析', summary: '讲解用晚清保守派将西方科技视为“奇技淫巧”的例子分析前后转折。转折后的明确观点是“中国传统并不排斥科学技术”，应与前面的例子及其表达的排斥区分。' },
] as const;
const sourceChecks: ReadonlyArray<readonly [number, string]> = [[560670, '命中单一目标'], [568110, '只能打一个'], [585140, '无法单独的应对多个目标'], [1663190, '奇技淫巧'], [1685370, '中国传统并不排斥科学技术'], [1700380, '转折之后说不排斥']];
const oldPointsSchema = z.object({ contentId: z.literal(contentId), points: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), tags: z.array(z.string()), importance: z.number(), refs: z.unknown() })) });
const noteSchema = z.object({ id: z.string(), contentId: z.literal(contentId), markdown: z.string(), sourceCount: z.literal(5), generatedAt: z.string().datetime() });
const backupSchema = z.object({ contentId: z.literal(contentId), ownerId: z.string(), protectedHash: z.string(), note: noteSchema, patchedMarkdown: z.string() });
const appliedSchema = z.object({ noteId: z.string(), generatedAt: z.string().datetime() });
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key: string, item: unknown): unknown => typeof item === 'bigint' ? item.toString() : item)).digest('hex');
}
// 固定核对这份旧自动笔记的完整结构，不重新生成来源或覆盖个人编辑。
function legacyMarkdown(points: KnowledgePoint[], oldPoints?: z.infer<typeof oldPointsSchema>['points']): string {
  return ['# AI 整理笔记', '', '> 由本资料的解析知识点自动整理。你的“实时笔记”独立保存，不会被覆盖。', '',
    ...points.flatMap((point, index) => [`## ${index + 1}. ${point.title}`, '', oldPoints?.find((saved) => saved.id === point.id)?.summary ?? point.summary,
      '来源：当前解析资料', point.tags.length ? `标签：${point.tags.map((tag) => `#${tag}`).join(' ')}` : '', '']),
  ].filter(Boolean).join('\n');
}
async function assertWebStopped(): Promise<void> {
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port: 3000 });
      socket.setTimeout(1500);
      socket.once('connect', (): void => { socket.destroy(); reject(new Error('修改前请停止本仓库3000端口网页，避免同期重新生成或编辑')); });
      socket.once('timeout', (): void => { socket.destroy(); reject(new Error('不能确认网页已停止')); });
      socket.once('error', (reason: NodeJS.ErrnoException): void => { socket.destroy(); if (reason.code === 'ECONNREFUSED') resolve(); else reject(new Error('不能确认端口状态')); });
    });
  }
}
async function main(): Promise<void> {
  const [mode, outputDir] = process.argv.slice(2);
  if (!['preview', 'apply', 'restore-preview', 'restore', 'verify'].includes(mode) || !outputDir) throw new Error('用法：tsx scripts/acceptance/sync-demo-generated-note.ts preview|apply|restore-preview|restore|verify <备份目录>');
  const { prisma } = await import('../../src/lib/prisma');
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, select: { ownerId: true, owner: { select: { email: true, role: true } } } });
    const oldPoints = oldPointsSchema.parse(JSON.parse(await readFile('.taskbook-working/exercise-correction-20261010/backup.json', 'utf8'))).points;
    if (oldPoints.length !== 2 || replacements.some((item) => !oldPoints.some((saved) => saved.id === item.id && saved.title === item.title))) throw new Error('§20.9原始备份范围不符');
    const read = async (tx: Prisma.TransactionClient): Promise<{ note: Awaited<ReturnType<typeof tx.generatedNote.findUniqueOrThrow>>; points: KnowledgePoint[] }> => {
      const note = await tx.generatedNote.findUniqueOrThrow({ where: { contentId } });
      const points = await tx.knowledgePoint.findMany({ where: { contentId }, orderBy: [{ importance: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] });
      if (note.sourceCount !== 5 || points.length !== 5 || points.some((item) => item.ownerId !== content.ownerId)) throw new Error('笔记来源数量或归属改变');
      for (const replacement of replacements) {
        const point = points.find((item) => item.id === replacement.id);
        const saved = oldPoints.find((item) => item.id === replacement.id);
        if (!point || !saved || point.title !== replacement.title || point.summary !== replacement.summary || hash({ title: point.title, tags: point.tags, importance: point.importance, refs: point.refs }) !== hash({ title: saved.title, tags: saved.tags, importance: saved.importance, refs: saved.refs })) throw new Error('知识点摘要或引用与已校订版本不符');
      }
      if (await tx.asyncJob.count({ where: { contentId, state: { in: ['PENDING', 'RUNNING'] } } })) throw new Error('资料存在在途后台任务');
      const sources = await tx.transcriptSegment.findMany({ where: { contentId, startMs: { in: sourceChecks.map(([time]) => time) } } });
      if (sources.length !== sourceChecks.length || sourceChecks.some(([time, text]) => !sources.some((item) => item.startMs === time && item.text.includes(text)))) throw new Error('原始来源锚点或文字不符');
      return { note, points };
    };
    const protectedHash = async (tx: Prisma.TransactionClient): Promise<string> => {
      const { note } = await read(tx);
      const values = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: content.ownerId }, select: { xpTotal: true, updatedAt: true } }),
        tx.learningContent.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.note.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.learningProgress.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.mastery.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.exerciseRecord.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.learningPlan.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.flashcard.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.generatedNote.findMany({ where: { content: { ownerId: content.ownerId }, contentId: { not: contentId } }, orderBy: { id: 'asc' } }),
        tx.knowledgePoint.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.transcriptSegment.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.textBlock.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.graphNode.findMany({ where: { point: { contentId } }, orderBy: { id: 'asc' } }),
        tx.graphEdge.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.exercise.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
      ]);
      return hash([...values, { id: note.id, contentId: note.contentId, sourceCount: note.sourceCount }]);
    };
    const state = await read(prisma);
    const originalMarkdown = legacyMarkdown(state.points, oldPoints);
    const patchedMarkdown = legacyMarkdown(state.points);
    let patched = originalMarkdown;
    for (const replacement of replacements) {
      const old = oldPoints.find((item) => item.id === replacement.id)?.summary;
      if (!old || patched.split(old).length !== 2) throw new Error('旧摘要缺失或重复，停止');
      patched = patched.replace(old, replacement.summary);
    }
    if (patched !== patchedMarkdown) throw new Error('预期差异不止两个摘要，停止');
    const restore = mode.startsWith('restore');
    const saved = restore || mode === 'verify' ? backupSchema.parse(JSON.parse(await readFile(join(outputDir, 'backup.json'), 'utf8'))) : undefined;
    const applied = restore || mode === 'verify' ? appliedSchema.parse(JSON.parse(await readFile(join(outputDir, 'apply-result.json'), 'utf8'))) : undefined;
    if (saved && (saved.ownerId !== content.ownerId || saved.note.id !== state.note.id || saved.note.markdown !== originalMarkdown || saved.patchedMarkdown !== patchedMarkdown || applied?.noteId !== state.note.id)) throw new Error('备份归属、范围或内容不符');
    const expected = restore || mode === 'verify' ? patchedMarkdown : originalMarkdown;
    if (state.note.markdown !== expected || (applied && state.note.generatedAt.toISOString() !== applied.generatedAt)) throw new Error('笔记旧值/版本不符，可能同期编辑或已同步，停止');
    const beforeHash = await protectedHash(prisma);
    if (restore && saved?.protectedHash !== beforeHash) throw new Error('保护数据已变化，停止恢复');
    await mkdir(outputDir, { recursive: true });
    if (mode === 'verify') {
      const { signAccessToken } = await import('../../src/lib/auth/jwt');
      const token = signAccessToken({ sub: content.ownerId, email: content.owner.email, role: content.owner.role });
      const url = `http://localhost:3000/api/contents/${contentId}/generated-note`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const anonymous = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (response.status !== 200 || anonymous.status !== 401) throw new Error('真实接口认证状态不符');
      const api = z.object({ data: z.object({ note: z.object({ markdown: z.string(), sourceCount: z.number(), generatedAt: z.string() }) }) }).parse(await response.json()).data.note;
      if (response.status !== 200 || anonymous.status !== 401 || api.markdown !== patchedMarkdown || api.sourceCount !== 5 || api.generatedAt !== state.note.generatedAt.toISOString() || await protectedHash(prisma) !== beforeHash) throw new Error('真实只读接口验收失败');
      const report = { verifiedAt: new Date().toISOString(), authenticatedStatus: response.status, anonymousStatus: anonymous.status, contentId, noteId: state.note.id, paragraphsMatched: 2, sourceCount: api.sourceCount, generatedAt: api.generatedAt, recordsUnchanged: true, dataWritten: false, modelCalled: false };
      await writeFile(join(outputDir, 'api-verification.json'), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify(report) + '\n'); return;
    }
    const nextMarkdown = restore ? originalMarkdown : patchedMarkdown;
    if (mode.endsWith('preview')) {
      await writeFile(join(outputDir, `${mode}.json`), JSON.stringify({ contentId, mode, dataWritten: false, noteId: state.note.id, generatedAt: state.note.generatedAt.toISOString(), protectedHash: beforeHash, beforeMarkdown: state.note.markdown, afterMarkdown: nextMarkdown, paragraphsChanged: 2 }, null, 2));
      process.stdout.write(JSON.stringify({ mode, paragraphsChanged: 2, dataWritten: false }) + '\n'); return;
    }
    await assertWebStopped();
    if (!restore) await writeFile(join(outputDir, 'backup.json'), JSON.stringify({ contentId, ownerId: content.ownerId, protectedHash: beforeHash, note: state.note, patchedMarkdown, backedUpAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
    const after = await prisma.$transaction(async (tx): Promise<Awaited<ReturnType<typeof tx.generatedNote.findUniqueOrThrow>>> => {
      if (await protectedHash(tx) !== beforeHash) throw new Error('保护数据同期改变，事务回滚');
      const changed = await tx.generatedNote.updateMany({ where: { id: state.note.id, contentId, sourceCount: 5, markdown: expected, generatedAt: state.note.generatedAt }, data: { markdown: nextMarkdown } });
      if (changed.count !== 1) throw new Error('笔记同期编辑，事务回滚');
      if (await protectedHash(tx) !== beforeHash) throw new Error('保护数据改变，事务回滚');
      return tx.generatedNote.findUniqueOrThrow({ where: { contentId } });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    if (after.markdown !== nextMarkdown || await protectedHash(prisma) !== beforeHash) throw new Error('事务后状态不符，需检查');
    const result = { verifiedAt: new Date().toISOString(), contentId, mode, noteId: after.id, generatedAt: after.generatedAt.toISOString(), previousGeneratedAt: state.note.generatedAt.toISOString(), paragraphsChanged: 2, protectedBefore: beforeHash, protectedAfter: beforeHash, protectedUnchanged: true, modelCalled: false, scoresWritten: false };
    await writeFile(join(outputDir, `${mode}-result.json`), JSON.stringify(result, null, 2)); process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '同步失败') + '\n'); process.exitCode = 1; });
