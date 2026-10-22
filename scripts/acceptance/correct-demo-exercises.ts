import { loadEnvConfig } from '@next/env';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';

loadEnvConfig(process.cwd());
const contentId = 'cmuqhyf7h00027q29tijy4uer';
const corrections = [
  {
    exerciseId: 'cmv21zesd001jdubgxxyuslxv',
    question: '讲解的直播打赏案例中，遏制诱骗直播打赏旨在促进什么？',
    options: ['主播短期打赏收入增长', '更多主播效仿诱骗做法', '行业长远发展', '忽略对被害人处境的关注'],
    correctAnswer: '行业长远发展',
    explanation: '讲解指出，诱骗直播打赏会加剧乱象、影响行业长远发展，应加以遏制；其目的不是增加短期收入、鼓励效仿或忽略被害人。',
    summary: undefined,
    anchors: [42490, 103420, 238570],
  },
  {
    exerciseId: 'cmv21zesd001ndubgpct5nc3o',
    question: '讲解中，只能命中单一目标的防空导弹为何难以应对饱和袭击？',
    options: ['单枚防空导弹能同时命中所有来袭目标', '一次只能应对一个目标，难以应对多个目标', '饱和袭击每次只包含一个目标', '命中单一目标就等于发动饱和袭击'],
    correctAnswer: '一次只能应对一个目标，难以应对多个目标',
    explanation: '讲解说来袭方可实施饱和袭击，而这类防空导弹只能命中单一目标，无法单独应对多个目标。不是防空导弹发动饱和袭击，也不是来袭目标只有一个。',
    summary: '讲解通过饱和袭击情境分析填空：来袭方可以实施饱和袭击，而只能命中单一目标的防空导弹难以单独应对多个目标。应明确区分来袭方与防御方，不能把命中单一目标理解为发动饱和袭击。',
    anchors: [560670, 568110, 585140],
  },
  {
    exerciseId: 'cmv21zesd001pdubggvv1sbz0',
    question: '讲解中，企业在学习、模仿其他企业文化之外，还应重点做什么？',
    options: ['只要完整复制成功企业文化，就一定能成功', '为提高效率，忽略自身硬件与文化的兼容匹配', '无需探索实践经验，模仿本身就是最终目标', '探索自身的企业文化实践经验，并关注兼容匹配'],
    correctAnswer: '探索自身的企业文化实践经验，并关注兼容匹配',
    explanation: '讲解强调不仅要学习、模仿，更要探索文化实践经验；仅靠复制且忽视兼容匹配可能徒劳。其他选项分别误将复制视为成功保证、忽略兼容或否定探索。',
    summary: undefined,
    anchors: [1217630, 1223770, 1251030],
  },
  {
    exerciseId: 'cmv21zesd001rdubgydd1toqn',
    question: '讲解引用的论述在转折后，对“中国传统是否排斥科学技术”持什么观点？',
    options: ['中国传统并不排斥科学技术', '中国传统一概排斥科学技术', '中国传统认为科学技术没有任何价值'],
    correctAnswer: '中国传统并不排斥科学技术',
    explanation: '转折后的原文明确说“中国传统并不排斥科学技术”。晚清保守派的例子属于前面的论述层次，不能代替转折后的观点；后两项与明确结论相反。',
    summary: '讲解用晚清保守派将西方科技视为“奇技淫巧”的例子分析前后转折。转折后的明确观点是“中国传统并不排斥科学技术”，应与前面的例子及其表达的排斥区分。',
    anchors: [1663190, 1685370, 1700380],
  },
] as const;
const questionFields = z.object({
  exerciseId: z.string(), type: z.literal('SINGLE_CHOICE'), question: z.string(), options: z.array(z.string()),
  correctAnswer: z.string(), explanation: z.string(), unattempted: z.literal(true), point: z.object({ summary: z.string() }),
});
const auditSchema = z.object({ contentId: z.literal(contentId), questions: z.array(questionFields) });
const backupSchema = z.object({
  contentId: z.literal(contentId), ownerId: z.string(), protectedHash: z.string(),
  exercises: z.array(z.object({ id: z.string(), pointId: z.string(), question: z.string(), options: z.array(z.string()), correctAnswer: z.string(), explanation: z.string() })),
  points: z.array(z.object({ id: z.string(), summary: z.string() })),
});
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_key: string, item: unknown): unknown => typeof item === 'bigint' ? item.toString() : item)).digest('hex'); }
async function assertWebStopped(): Promise<void> {
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port: 3000 });
      socket.setTimeout(1500);
      socket.once('connect', (): void => { socket.destroy(); reject(new Error('修改前请停止本仓库3000端口网页，避免在途作答按旧答案判分')); });
      socket.once('timeout', (): void => { socket.destroy(); reject(new Error('不能确认网页已停止')); });
      socket.once('error', (reason: NodeJS.ErrnoException): void => { socket.destroy(); if (reason.code === 'ECONNREFUSED') resolve(); else reject(new Error('不能确认本地端口状态')); });
    });
  }
}
async function main(): Promise<void> {
  const [mode, outputDir] = process.argv.slice(2);
  if (!['preview', 'apply', 'restore-preview', 'restore'].includes(mode) || !outputDir) throw new Error('用法：tsx scripts/acceptance/correct-demo-exercises.ts preview|apply|restore-preview|restore <备份目录>');
  const { prisma } = await import('../../src/lib/prisma');
  const ids = corrections.map((item) => item.exerciseId);
  try {
    const content = await prisma.learningContent.findUniqueOrThrow({ where: { id: contentId }, select: { ownerId: true } });
    const read = async (tx: Prisma.TransactionClient): Promise<{ exercises: Awaited<ReturnType<typeof tx.exercise.findMany>>; points: Awaited<ReturnType<typeof tx.knowledgePoint.findMany>> }> => {
      const exercises = await tx.exercise.findMany({ where: { contentId }, orderBy: { id: 'asc' } });
      const points = await tx.knowledgePoint.findMany({ where: { contentId }, orderBy: { id: 'asc' } });
      if (exercises.length !== 5 || ids.some((id) => !exercises.some((item) => item.id === id))) throw new Error('演示题集合已变化，停止校订');
      if (points.some((item) => item.ownerId !== content.ownerId)) throw new Error('知识点归属不符');
      if (await tx.exerciseRecord.count({ where: { exerciseId: { in: ids } } })) throw new Error('目标题已有作答，停止，不能改写历史判分依据');
      if (await tx.asyncJob.count({ where: { contentId, state: { in: ['PENDING', 'RUNNING'] } } })) throw new Error('资料仍有后台任务，停止校订');
      return { exercises, points };
    };
    const protectedHash = async (tx: Prisma.TransactionClient): Promise<string> => {
      const { exercises, points } = await read(tx);
      const mutablePointIds = corrections.filter((item) => item.summary !== undefined).map((item) => exercises.find((question) => question.id === item.exerciseId)?.pointId);
      const values = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: content.ownerId }, select: { xpTotal: true, updatedAt: true } }),
        tx.learningContent.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.note.findMany({ where: { ownerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.learningProgress.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.mastery.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.exerciseRecord.findMany({ where: { learnerId: content.ownerId }, orderBy: { id: 'asc' } }),
        tx.flashcard.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.generatedNote.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.transcriptSegment.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.textBlock.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.graphNode.findMany({ where: { point: { contentId } }, orderBy: { id: 'asc' } }),
        tx.graphEdge.findMany({ where: { contentId }, orderBy: { id: 'asc' } }),
        tx.exercise.findMany({ where: { id: { notIn: ids } }, orderBy: { id: 'asc' } }),
      ]);
      // 排除且仅排除允许修改的文字；ID、引用、创建时间等仍参与指纹。
      return hash([...values, exercises.map((item) => ids.includes(item.id as typeof ids[number]) ? { ...item, question: null, options: null, correctAnswer: null, explanation: null } : item), points.map((item) => mutablePointIds.includes(item.id) ? { ...item, summary: null } : item)]);
    };
    const state = await read(prisma);
    const beforeHash = await protectedHash(prisma);
    const restore = mode.startsWith('restore');
    const backupPath = join(outputDir, 'backup.json');
    const backup = restore ? backupSchema.parse(JSON.parse(await readFile(backupPath, 'utf8'))) : undefined;
    if (backup && (backup.ownerId !== content.ownerId || backup.protectedHash !== beforeHash || backup.exercises.length !== ids.length || backup.points.length !== 2 || new Set(backup.exercises.map((item) => item.id)).size !== ids.length)) throw new Error('备份归属、范围或保护指纹不符，停止恢复');
    const oldAudit = auditSchema.parse(JSON.parse(await readFile('.taskbook-working/exercise-quality-20261010/real-questions.json', 'utf8')));
    const proposals = corrections.map((correction) => {
      const current = state.exercises.find((item) => item.id === correction.exerciseId);
      const point = state.points.find((item) => item.id === current?.pointId);
      if (!current || !point || current.type !== 'SINGLE_CHOICE') throw new Error('题目或知识点不存在');
      const old = restore ? correction : oldAudit?.questions.find((item) => item.exerciseId === current.id);
      if (!old || hash({ question: current.question, options: current.options, correctAnswer: current.correctAnswer, explanation: current.explanation }) !== hash({ question: old.question, options: old.options, correctAnswer: old.correctAnswer, explanation: old.explanation })) throw new Error('题目旧值不符，已修改或已校订，停止');
      const expectedSummary = restore ? correction.summary : oldAudit?.questions.find((item) => item.exerciseId === current.id)?.point.summary;
      if (expectedSummary !== undefined && point.summary !== expectedSummary) throw new Error('知识点旧摘要不符，停止');
      const saved = backup?.exercises.find((item) => item.id === current.id && item.pointId === current.pointId);
      const savedPoint = backup?.points.find((item) => item.id === point.id);
      if (restore && (!saved || (correction.summary !== undefined && !savedPoint))) throw new Error('备份ID不符');
      if (restore) {
        const original = oldAudit.questions.find((item) => item.exerciseId === current.id);
        if (!saved || !original || hash({ question: saved.question, options: saved.options, correctAnswer: saved.correctAnswer, explanation: saved.explanation }) !== hash({ question: original.question, options: original.options, correctAnswer: original.correctAnswer, explanation: original.explanation }) || (correction.summary !== undefined && savedPoint?.summary !== original.point.summary)) throw new Error('备份文字与校订前审计不符，停止恢复');
      }
      const next = saved ?? correction;
      const options: string[] = [...next.options];
      if (options.length < 2 || options.length > 6 || new Set(options).size !== options.length || !options.includes(next.correctAnswer)) throw new Error('新选项/答案无效');
      return { id: current.id, pointId: current.pointId, before: { question: current.question, options: current.options, correctAnswer: current.correctAnswer, explanation: current.explanation }, after: { question: next.question, options, correctAnswer: next.correctAnswer, explanation: next.explanation }, summary: correction.summary === undefined ? undefined : { before: point.summary, after: savedPoint?.summary ?? correction.summary }, anchors: correction.anchors };
    });
    const sources = await prisma.transcriptSegment.findMany({ where: { contentId, startMs: { in: corrections.flatMap((item) => [...item.anchors]) } }, orderBy: { startMs: 'asc' } });
    if (new Set(sources.map((item) => item.startMs)).size !== new Set(corrections.flatMap((item) => [...item.anchors])).size) throw new Error('原始来源锚点缺失，停止');
    const sourceChecks: ReadonlyArray<readonly [number, string]> = [[42490, '诱骗直播打赏不加遏制'], [103420, '刑法介入'], [238570, '长远'], [560670, '命中单一目标'], [568110, '只能打一个'], [585140, '无法单独的应对多个目标'], [1217630, '不仅仅'], [1223770, '探索'], [1251030, '忽视了兼容匹配'], [1663190, '奇技淫巧'], [1685370, '中国传统并不排斥科学技术'], [1700380, '转折之后说不排斥']];
    if (sourceChecks.some(([startMs, text]) => !sources.some((item) => item.startMs === startMs && item.text.includes(text)))) throw new Error('原始来源文字与人工核对不符，停止');
    await mkdir(outputDir, { recursive: true });
    if (mode.endsWith('preview')) {
      await writeFile(join(outputDir, `${mode}.json`), JSON.stringify({ contentId, mode, dataWritten: false, protectedHash: beforeHash, proposals, sources }, null, 2));
      process.stdout.write(JSON.stringify({ mode, questions: proposals.length, summaries: proposals.filter((item) => item.summary).length, dataWritten: false }) + '\n'); return;
    }
    await assertWebStopped();
    if (!restore) {
      await writeFile(backupPath, JSON.stringify({ contentId, ownerId: content.ownerId, protectedHash: beforeHash, exercises: state.exercises.filter((item) => ids.includes(item.id as typeof ids[number])), points: state.points.filter((item) => proposals.some((proposal) => proposal.pointId === item.id && proposal.summary)), sources, backedUpAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
    }
    await prisma.$transaction(async (tx): Promise<void> => {
      if (await protectedHash(tx) !== beforeHash) throw new Error('保护数据已变化，停止');
      const latest = await read(tx);
      for (const proposal of proposals) {
        const changed = await tx.exercise.updateMany({ where: { id: proposal.id, contentId, records: { none: {} }, ...proposal.before, options: { equals: proposal.before.options } }, data: proposal.after });
        if (changed.count !== 1) throw new Error('题目被修改或新增作答，事务回滚');
        if (proposal.summary) {
          const changedPoint = await tx.knowledgePoint.updateMany({ where: { id: proposal.pointId, contentId, ownerId: content.ownerId, summary: proposal.summary.before }, data: { summary: proposal.summary.after } });
          if (changedPoint.count !== 1) throw new Error('摘要被修改，事务回滚');
        }
      }
      if (latest.exercises.length !== 5 || await protectedHash(tx) !== beforeHash) throw new Error('保护数据改变，事务回滚');
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    const afterHash = await protectedHash(prisma);
    if (beforeHash !== afterHash) throw new Error('事务后保护指纹变化，需检查，不能记作成功');
    await writeFile(join(outputDir, `${mode}-result.json`), JSON.stringify({ verifiedAt: new Date().toISOString(), contentId, mode, questionsChanged: proposals.length, summariesChanged: proposals.filter((item) => item.summary).length, protectedBefore: beforeHash, protectedAfter: afterHash, protectedUnchanged: true, modelCalled: false, scoresWritten: false, proposals }, null, 2));
    process.stdout.write(JSON.stringify({ mode, questionsChanged: proposals.length, summariesChanged: proposals.filter((item) => item.summary).length, protectedUnchanged: true }) + '\n');
  } finally { await prisma.$disconnect(); }
}
void main().catch((reason: unknown): void => { process.stderr.write((reason instanceof Error ? reason.message : '校订失败') + '\n'); process.exitCode = 1; });
