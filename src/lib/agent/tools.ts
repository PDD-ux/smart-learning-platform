import type { KnowledgePoint, LearningContent } from '@prisma/client';
import { checkContent, sanitizeInput } from '@/lib/ai/content-guard';
import { ErrorCode } from '@/lib/api/errors';
import { ApiError } from '@/lib/auth/ownership';
import { contentRefSchema, isRefInRange, type ContentRef } from '@/lib/domain/content-ref';
import { prisma } from '@/lib/prisma';
import type { AgentDecision, AgentPractice } from './contracts';
import { parseSearchQuery, rankSources, transcriptContext, videoWindows, type SourceRow } from './retrieval';

export type AgentScope = Pick<LearningContent, 'id' | 'ownerId' | 'title' | 'contentType' | 'durationSec' | 'pageCount'>;
export type AgentEvidence = { ref: ContentRef; excerpt: string };
export type ToolState = { scope: AgentScope; points: KnowledgePoint[]; evidence: AgentEvidence[]; practice: AgentPractice[] };
type ToolResult = { observation: unknown; summary: string };

export async function createToolState(contentId: string, ownerId: string): Promise<ToolState> {
  const scope = await prisma.learningContent.findUnique({ where: { id: contentId }, select: { id: true, ownerId: true, title: true, contentType: true, durationSec: true, pageCount: true, status: true, understandingStatus: true } });
  if (!scope) throw new ApiError(ErrorCode.CONTENT_NOT_FOUND, '资料不存在');
  // 此处不得使用管理员免归属的审核规则，Agent只能读取本人资料。
  if (scope.ownerId !== ownerId) throw new ApiError(ErrorCode.FORBIDDEN, '只能使用本人的学习资料');
  if (scope.status !== 'READY') throw new ApiError(ErrorCode.CONTENT_NOT_READY, '资料尚未就绪');
  if (scope.understandingStatus !== 'COMPLETED') throw new ApiError(ErrorCode.NO_UNDERSTANDING, '请等待资料解析完成');
  const points = await prisma.knowledgePoint.findMany({ where: { contentId, ownerId }, orderBy: [{ importance: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }], take: 30 });
  return { scope, points, evidence: [], practice: [] };
}

function validRef(value: unknown, scope: AgentScope): ContentRef | null {
  const parsed = contentRefSchema.safeParse(value);
  return parsed.success && parsed.data.type === (scope.contentType === 'VIDEO' ? 'video' : 'document') && isRefInRange(parsed.data, scope) ? parsed.data : null;
}

async function learningStatus(state: ToolState): Promise<ToolResult> {
  const { scope, points } = state;
  const [mastery, records, due, plans, progress] = await Promise.all([
    prisma.mastery.findMany({ where: { learnerId: scope.ownerId, pointId: { in: points.map((point) => point.id) } } }),
    prisma.exerciseRecord.findMany({ where: { learnerId: scope.ownerId, exercise: { contentId: scope.id, content: { ownerId: scope.ownerId }, point: { ownerId: scope.ownerId } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select: { correct: true, createdAt: true, exercise: { select: { pointId: true } } } }),
    prisma.flashcard.count({ where: { ownerId: scope.ownerId, contentId: scope.id, nextReviewAt: { lte: new Date() } } }),
    prisma.learningPlan.count({ where: { ownerId: scope.ownerId, contentId: scope.id, completedAt: null } }),
    prisma.learningProgress.findUnique({ where: { learnerId_contentId: { learnerId: scope.ownerId, contentId: scope.id } }, select: { ref: true, lastStudiedAt: true } }),
  ]);
  const pointItems = points.map((point, index) => {
    const learned = mastery.find((row) => row.pointId === point.id);
    const attempts = records.filter((row) => row.exercise.pointId === point.id);
    return { pointNumber: index + 1, title: sanitizeInput(point.title, 100), summary: sanitizeInput(point.summary, 180), score: learned?.score ?? null, isWeak: learned ? learned.score < 0.6 : null, recentAttempts: attempts.length, recentWrong: attempts.filter((row) => !row.correct).length };
  });
  const scored = pointItems.filter((point) => point.score !== null);
  const masterySummary = scored.length ? `已读取${scored.length}个掌握记录（${scored.slice(0, 5).map((point) => `${point.title}：${Math.round((point.score ?? 0) * 100)}%`).join('、')}），未知${points.length - scored.length}个${scored.length > 5 ? '；仅展示前5项分数' : ''}` : '暂无掌握记录';
  return { observation: { points: pointItems, pointLimit: 30, dueFlashcards: due, unfinishedPlans: plans, recentAttemptCount: records.length, recentCorrectCount: records.filter((row) => row.correct).length, recordLimit: 50, progress, note: '逐项读取score：数字（包括0）表示真实掌握记录，仅null表示未知；0分不是null。最近作答样本不等于全站/今日成绩。' }, summary: `${points.length}个知识点，最近${records.length}次作答，${due}张到期卡；${masterySummary}` };
}

async function searchMaterial(state: ToolState, action: Extract<AgentDecision, { action: 'search_material' }>): Promise<ToolResult> {
  const { scope } = state;
  const query = parseSearchQuery(action.query);
  const matchingPoints = state.points.filter((item) => item.title.trim() && (query.identifiers.some((identifier) => item.title.toLowerCase().includes(identifier)) || action.query.toLowerCase().includes(item.title.toLowerCase())));
  const point = action.pointNumber ? state.points[action.pointNumber - 1] : matchingPoints.length === 1 ? matchingPoints[0] : undefined;
  const refs = point && Array.isArray(point.refs) ? point.refs.map((value) => validRef(value, scope)).filter((ref): ref is ContentRef => ref !== null) : [];
  const anchorWindows = videoWindows(refs, scope.durationSec);
  const anchorPages = refs.filter((ref): ref is Extract<ContentRef, { type: 'document' }> => ref.type === 'document').slice(0, 4).map((ref) => ref.page);
  const matches = { OR: (query.identifiers.length ? query.identifiers : query.terms).map((term) => ({ text: { contains: term, mode: 'insensitive' as const } })) };
  // 旧知识点定位可能处于讲解中段。明确题号先精确检索全课候选，不能被中段窗口挡住题干。
  const transcriptWhere = { contentId: scope.id, ...(anchorWindows.length && !query.identifiers.length ? { OR: anchorWindows.map((window) => ({ startMs: window })) } : matches) };
  const textWhere = { contentId: scope.id, ...matches, ...(anchorPages.length ? { AND: [{ OR: anchorPages.map((page) => ({ ref: { path: ['page'], equals: page } })) }] } : {}) };
  const [transcripts, texts, transcriptCount, textCount] = await Promise.all([
    scope.contentType === 'VIDEO' ? prisma.transcriptSegment.findMany({ where: transcriptWhere, orderBy: [{ startMs: 'asc' }, { id: 'asc' }], take: 2000, select: { startMs: true, endMs: true, text: true } }) : Promise.resolve([]),
    prisma.textBlock.findMany({ where: textWhere, orderBy: [{ sequence: 'asc' }, { id: 'asc' }], take: 2000, select: { ref: true, text: true } }),
    scope.contentType === 'VIDEO' ? prisma.transcriptSegment.count({ where: transcriptWhere }) : Promise.resolve(0),
    prisma.textBlock.count({ where: textWhere }),
  ]);
  const sources: SourceRow[] = [];
  const textSources: SourceRow[] = [];
  for (const row of transcripts) {
    const ref = validRef({ type: 'video', timestampSec: Math.floor(row.startMs / 1000) }, scope);
    if (ref) sources.push({ ref, text: row.text });
  }
  for (const row of texts) {
    const ref = validRef(row.ref, scope);
    if (ref && (!refs.length || (scope.contentType === 'VIDEO' && query.identifiers.length) || refs.some((anchor) => ref.type === anchor.type && (ref.type === 'video' && anchor.type === 'video' ? ref.timestampSec >= anchor.timestampSec - 15 && ref.timestampSec <= anchor.timestampSec + 90 : ref.type === 'document' && anchor.type === 'document' && ref.page === anchor.page)))) { sources.push({ ref, text: row.text }); textSources.push({ ref, text: row.text }); }
  }
  const ranked = rankSources(sources, query);
  const windows = videoWindows(ranked.filter((row) => row.ref.type === 'video').slice(0, 2).map((row) => row.ref), scope.durationSec, query.identifiers.length ? 0 : 15);
  const contextWhere = { contentId: scope.id, OR: windows.map((window) => ({ startMs: window })) };
  const [nearby, contextCount] = windows.length ? await Promise.all([
    prisma.transcriptSegment.findMany({ where: contextWhere, orderBy: [{ startMs: 'asc' }, { id: 'asc' }], take: 2000, select: { startMs: true, endMs: true, text: true } }),
    prisma.transcriptSegment.count({ where: contextWhere }),
  ]) : [[], 0];
  const context = transcriptContext(nearby.filter((row) => validRef({ type: 'video', timestampSec: Math.floor(row.startMs / 1000) }, scope)), windows);
  // 连续转写先提供，OCR仅补充同一窗口的命中，避免重复画面挤掉讲解后半句。
  const supplement = context.length ? rankSources(textSources, query).filter((row) => windows.some((window) => row.ref.type === 'video' && row.ref.timestampSec * 1000 >= window.gte && row.ref.timestampSec * 1000 <= window.lte)) : ranked;
  const selected = [...context.slice(0, 6), ...supplement].slice(0, 8);
  const result: Array<AgentEvidence & { sourceId: number }> = [];
  for (const row of selected) {
    const evidence = { ref: row.ref, excerpt: sanitizeInput(row.text.trim(), 500) };
    let index = state.evidence.findIndex((saved) => JSON.stringify(saved) === JSON.stringify(evidence));
    if (index < 0) { state.evidence.push(evidence); index = state.evidence.length - 1; }
    if (!result.some((saved) => saved.sourceId === index + 1)) result.push({ sourceId: index + 1, ...evidence });
  }
  const truncated = transcriptCount > 2000 || textCount > 2000 || contextCount > 2000;
  return { observation: { sources: result, candidateLimitPerKind: 2000, contextCandidateLimit: 2000, truncated, note: '连续转写仅按相邻真实段落换行组合，定位为首段实际起点；题号命中读取后90秒，其它关键词读取前15秒/后90秒，窗口不是语义边界。只核对这些原文，不代表全课覆盖；引用必须使用真实sourceId。未命中说明依据不足，可换关键词检索。' }, summary: `找到${result.length}段可核对原文${truncated ? '，候选已截断' : ''}` };
}

async function selectPractice(state: ToolState, action: Extract<AgentDecision, { action: 'select_practice' }>): Promise<ToolResult> {
  const { scope } = state;
  const selectedPoints = action.pointNumbers.length ? action.pointNumbers.map((number) => state.points[number - 1]) : state.points;
  const rows = await prisma.exercise.findMany({ where: { contentId: scope.id, content: { ownerId: scope.ownerId }, point: { ownerId: scope.ownerId }, pointId: { in: selectedPoints.map((point) => point.id) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
    select: { id: true, pointId: true, type: true, question: true, options: true, point: { select: { title: true } }, records: { where: { learnerId: scope.ownerId }, orderBy: { createdAt: 'desc' }, take: 1, select: { correct: true } } },
  });
  const priority = (row: typeof rows[number]): number => row.records[0]?.correct === false ? 0 : !row.records.length ? 1 : 2;
  const picked = rows.sort((left, right) => priority(left) - priority(right)).slice(0, action.count);
  const observation = picked.map((row) => {
    const type = row.type === 'SINGLE_CHOICE' ? 'single_choice' as const : row.type === 'TRUE_FALSE' ? 'true_false' as const : 'short_answer' as const;
    let index = state.practice.findIndex((item) => item.exerciseId === row.id);
    if (index < 0) {
      state.practice.push({ exerciseId: row.id, contentId: scope.id, contentTitle: scope.title, pointId: row.pointId, pointTitle: row.point.title, type, question: row.question, options: row.options, index: state.practice.length + 1, latestRecord: null }); index = state.practice.length - 1;
    }
    return { exerciseNumber: index + 1, pointTitle: row.point.title, type, question: sanitizeInput(row.question, 300), status: row.records[0]?.correct === false ? '最近答错' : !row.records.length ? '未作答' : '最近答对' };
  });
  return { observation: { exercises: observation, candidateLimit: 50, note: '只有本人实际提交才判分；不能代答、泄露标准答案或声称已完成。没有题目可前往原题库主动生成。' }, summary: `从已有题库挑选${picked.length}题，未提交答案` };
}

export async function executeAgentTool(state: ToolState, action: Exclude<AgentDecision, { action: 'finish' }>): Promise<ToolResult> {
  // 每次读工具前复核资源，避免长请求中资料被删除/转移后继续读取。
  const owned = await prisma.learningContent.findFirst({ where: { id: state.scope.id, ownerId: state.scope.ownerId }, select: { id: true } });
  if (!owned) throw new ApiError(ErrorCode.CONTENT_NOT_FOUND, '当前资料已不可访问');
  if (action.action === 'learning_status') return learningStatus(state);
  if (action.action === 'search_material') return searchMaterial(state, action);
  return selectPractice(state, action);
}
