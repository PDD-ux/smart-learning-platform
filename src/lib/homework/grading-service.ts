import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { HomeworkDraft, HomeworkGradingReport as HomeworkGradingReportRow, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AiError } from '@/lib/ai/spark';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { recordAudit } from '@/lib/audit/audit-service';
import { account, transaction } from '@/lib/classrooms/service';
import { completeQuestions, questionSchema, type HomeworkQuestion } from './contracts';
import { evaluateHomeworkCorrection, evaluateHomeworkQuestions } from './grading-ai';
import {
  GRADING_LEASE_MS,
  MAX_CORRECTIONS_PER_REPORT,
  MAX_GRADING_INPUT_CHARS,
  MAX_GRADING_OPERATIONS,
  MAX_GRADING_QUESTIONS,
  MAX_GRADING_REPORTS_PER_DRAFT,
  MAX_GRADING_REPORTS_READ,
  gradingCandidateSchema,
  gradingCandidateFieldsSchema,
  reportCommandSchema,
  reportCreateSchema,
  safeGradingErrorCodeSchema,
  type HomeworkCorrectionAttempt,
  type HomeworkGradingItem,
  type HomeworkGradingReport,
  type HomeworkGradingResult,
  type HomeworkMistakeItem,
  type HomeworkMistakeList,
  type ReportCommand,
  type ReportCreateInput,
} from './grading-contracts';

type Tx = Prisma.TransactionClient;
type Operation = { id: string; digest: string };
type StoredCorrection = HomeworkCorrectionAttempt & { digest: string };
type GradeSnapshot = { draftDigest: string; questions: HomeworkQuestion[] };
type LoadedReport = HomeworkGradingReportRow & { draft: Pick<HomeworkDraft, 'id' | 'ownerId' | 'title' | 'state'> };

const snapshotSchema = z.object({ draftDigest: z.string().length(64), questions: z.array(questionSchema).min(1).max(MAX_GRADING_QUESTIONS) }).strict();
const storedItemSchema = z.object({
  ...gradingCandidateFieldsSchema.shape,
  objectiveMatch: z.enum(['match', 'mismatch', 'unavailable']),
  objectiveScore: z.union([z.literal(0), z.literal(100)]).nullable(),
}).strict();
const resultSchema = z.object({ items: z.array(storedItemSchema).min(1).max(MAX_GRADING_QUESTIONS) }).strict();
const correctionSchema = z.object({
  requestId: z.string().uuid(), digest: z.string().length(64), number: z.string().min(1).max(20),
  beforeAnswer: z.string().max(2_000), correctedAnswer: z.string().max(2_000),
  state: z.enum(['RUNNING', 'READY', 'FAILED', 'CANCELLED']), result: storedItemSchema.nullable(),
  errorCode: safeGradingErrorCodeSchema.nullable(), createdAt: z.string(), completedAt: z.string().nullable(),
}).strict();

const inflight = new Map<string, AbortController>();
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
function missing(): never { throw new ApiError(ErrorCode.NOT_FOUND, '作业批改报告不存在或不可访问'); }
function conflict(message = '记录已变化，请重新读取后操作'): never { throw new ApiError(ErrorCode.CLASSROOM_CONFLICT, message); }
function invalid(message: string): never { throw new ApiError(ErrorCode.VALIDATION_FAILED, message); }
function checked<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, message);
  return parsed.data;
}
function studentRole(role: string): void { if (role !== 'student') missing(); }
function parseSnapshot(value: Prisma.JsonValue): GradeSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new AiError('冻结题目快照无效', 'SCHEMA_INVALID', 502);
  return parsed.data;
}
function parseResult(value: Prisma.JsonValue | null, questions?: HomeworkQuestion[]): HomeworkGradingResult | null {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) return null;
  if (questions) {
    const numbers = parsed.data.items.map((item): string => item.number);
    if (numbers.length !== questions.length || new Set(numbers).size !== questions.length || questions.some((question): boolean => !numbers.includes(question.number))) return null;
  }
  return { items: parsed.data.items as HomeworkGradingItem[] };
}
function parseCorrections(value: Prisma.JsonValue): StoredCorrection[] {
  const parsed = z.array(correctionSchema).max(MAX_CORRECTIONS_PER_REPORT).safeParse(value);
  if (!parsed.success) throw new AiError('订正历史格式无效', 'SCHEMA_INVALID', 502);
  return parsed.data as StoredCorrection[];
}
function parseOperations(value: Prisma.JsonValue): Operation[] {
  const parsed = z.array(z.object({ id: z.string().uuid(), digest: z.string().length(64) }).strict()).max(MAX_GRADING_OPERATIONS).safeParse(value);
  if (!parsed.success) throw new AiError('操作记录格式无效', 'SCHEMA_INVALID', 502);
  return parsed.data;
}
function reportView(row: HomeworkGradingReportRow): HomeworkGradingReport {
  const snapshot = snapshotSchema.safeParse(row.snapshot);
  const storedState = ['PENDING', 'RUNNING', 'READY', 'FAILED', 'CANCELLED'].includes(row.state)
    ? row.state as HomeworkGradingReport['state'] : 'FAILED';
  const result = parseResult(row.result, snapshot.success ? snapshot.data.questions : undefined);
  const state: HomeworkGradingReport['state'] = storedState === 'READY' && !result ? 'FAILED' : storedState;
  const error = state === 'FAILED' && storedState === 'READY' ? { success: true as const, data: 'SCHEMA_INVALID' as const } : safeGradingErrorCodeSchema.safeParse(row.errorCode);
  return {
    id: row.id,
    requestId: row.requestId,
    state,
    revision: row.revision,
    sourceRevision: row.sourceRevision,
    questionNumbers: snapshot.success ? snapshot.data.questions.map((question): string => question.number) : [],
    result,
    corrections: parseCorrections(row.corrections as Prisma.JsonValue).map(({ digest: _digest, ...correction }): HomeworkCorrectionAttempt => correction),
    errorCode: error.success ? error.data : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function inputChars(questions: HomeworkQuestion[]): number {
  return questions.reduce((total, question): number => total + question.number.length + question.prompt.length + question.answer.length + question.referenceAnswer.length + question.basis.length, 0);
}
function sourceDigest(draftId: string, revision: number, draftDigest: string, questions: HomeworkQuestion[]): string {
  return sha256(JSON.stringify({ draftId, revision, draftDigest, questions }));
}
function reportDigest(draftId: string, revision: number, questionNumbers: string[], digest: string): string {
  return sha256(JSON.stringify({ draftId, expectedDraftRevision: revision, questionNumbers, sourceDigest: digest }));
}
function operationDigest(reportId: string, input: ReportCommand): string { return sha256(JSON.stringify({ reportId, ...input })); }
function errorCode(error: unknown, aborted = false): z.infer<typeof safeGradingErrorCodeSchema> {
  if (aborted || error instanceof AiError && error.code === 'CANCELLED') return 'CANCELLED';
  if (error instanceof AiError && error.code === 'TIMEOUT') return 'AI_TIMEOUT';
  if (error instanceof AiError && error.code === 'SCHEMA_INVALID') return 'SCHEMA_INVALID';
  return 'AI_UNAVAILABLE';
}
export function gradingErrorMessage(code: z.infer<typeof safeGradingErrorCodeSchema> | null): string | null {
  if (code === 'AI_TIMEOUT') return '星火响应超时；本次没有保存部分批改结果。可保留记录后手动重新发起。';
  if (code === 'SCHEMA_INVALID') return '模型结果未通过题号和依据核验；本次没有保存部分结果。请核对题目后手动重新发起。';
  if (code === 'CANCELLED') return '本次分析已取消；原校对、报告和订正输入均已保留。';
  if (code === 'GRADING_EXPIRED') return '分析等待已超时，系统没有自动重复调用；请手动重新发起。';
  if (code === 'AI_UNAVAILABLE') return '星火服务当前不可用或未配置；本次没有保存部分批改结果。请稍后手动重新发起。';
  return null;
}

async function ownedDraft(tx: Tx, actorId: string, draftId: string, lock: boolean): Promise<HomeworkDraft> {
  studentRole((await account(tx, actorId, true)).role);
  if (lock) await tx.$queryRaw`SELECT id FROM "HomeworkDraft" WHERE id=${draftId} FOR UPDATE`;
  const row = await tx.homeworkDraft.findUnique({ where: { id: draftId } });
  if (!row || row.ownerId !== actorId) missing();
  return row;
}
async function ownedReport(tx: Tx, actorId: string, draftId: string, reportId: string, lock = true): Promise<LoadedReport> {
  studentRole((await account(tx, actorId, true)).role);
  if (lock) await tx.$queryRaw`SELECT id FROM "HomeworkGradingReport" WHERE id=${reportId} FOR UPDATE`;
  const row = await tx.homeworkGradingReport.findUnique({ where: { id: reportId }, include: { draft: { select: { id: true, ownerId: true, title: true, state: true } } } });
  if (!row || row.draftId !== draftId || row.draft.ownerId !== actorId) missing();
  return row;
}

export async function createHomeworkGradingReport(actorId: string, draftId: string, raw: unknown, db: PrismaClient = prisma): Promise<HomeworkGradingReport> {
  const input = checked(reportCreateSchema, raw, '批改请求不合法，请选择1至8道已确认题目');
  return transaction(db, async (tx): Promise<HomeworkGradingReport> => {
    const draft = await ownedDraft(tx, actorId, draftId, true);
    const old = await tx.homeworkGradingReport.findUnique({ where: { draftId_requestId: { draftId, requestId: input.requestId } } });
    if (old) {
      const digest = reportDigest(draftId, old.sourceRevision, input.questionNumbers, old.sourceDigest);
      if (input.expectedDraftRevision !== old.sourceRevision || digest !== old.requestDigest) conflict('该请求编号已用于其它批改范围');
      return reportView(old);
    }
    if (draft.state !== 'CONFIRMED') conflict('请先保存并确认题目、答案和评分依据，再开始批改');
    if (draft.revision !== input.expectedDraftRevision) conflict('校对版本已变化，请重新读取后选择题目');
    const saved = checked(z.array(questionSchema).max(20), draft.questions, '已确认的题目快照无效');
    const byNumber = new Map(saved.map((question): [string, HomeworkQuestion] => [question.number, question]));
    const questions = input.questionNumbers.map((number): HomeworkQuestion | undefined => byNumber.get(number));
    if (questions.some((question): boolean => question === undefined)) invalid('所选题号不属于这份已确认的作业');
    const selected = questions as HomeworkQuestion[];
    if (!completeQuestions(selected)) invalid('所选题目尚未逐题确认或缺少参考答案/评分依据');
    if (inputChars(selected) > MAX_GRADING_INPUT_CHARS) invalid('本批题目合计超过16000字符，请分批选择较少题目');
    if (await tx.homeworkGradingReport.count({ where: { draftId } }) >= MAX_GRADING_REPORTS_PER_DRAFT) conflict('本份作业已达到40份批改报告上限');
    const snapshot = { draftDigest: draft.createDigest, questions: selected } satisfies GradeSnapshot;
    const digest = sourceDigest(draftId, draft.revision, draft.createDigest, selected);
    const requestDigest = reportDigest(draftId, draft.revision, input.questionNumbers, digest);
    const row = await tx.homeworkGradingReport.create({ data: {
      id: crypto.randomUUID(), draftId, requestId: input.requestId, requestDigest, sourceDigest: digest,
      sourceRevision: draft.revision, snapshot: snapshot as unknown as Prisma.InputJsonValue, state: 'PENDING',
    } });
    await recordAudit({ actorId, objectId: row.id, action: 'homework.grading.create' }, tx);
    return reportView(row);
  });
}

export async function listHomeworkGradingReports(actorId: string, draftId: string, db: PrismaClient = prisma): Promise<{ items: HomeworkGradingReport[] }> {
  return transaction(db, async (tx): Promise<{ items: HomeworkGradingReport[] }> => {
    await ownedDraft(tx, actorId, draftId, false);
    const rows = await tx.homeworkGradingReport.findMany({ where: { draftId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MAX_GRADING_REPORTS_READ });
    const now = new Date();
    for (const row of rows) if (row.state === 'RUNNING' && row.leaseExpiresAt && row.leaseExpiresAt <= now) {
      await tx.homeworkGradingReport.updateMany({ where: { id: row.id, state: 'RUNNING', leaseExpiresAt: { lte: now } }, data: { state: 'FAILED', errorCode: 'GRADING_EXPIRED', leaseExpiresAt: null, revision: { increment: 1 } } });
    }
    const fresh = rows.some((row): boolean => row.state === 'RUNNING' && !!row.leaseExpiresAt && row.leaseExpiresAt <= now)
      ? await tx.homeworkGradingReport.findMany({ where: { draftId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MAX_GRADING_REPORTS_READ }) : rows;
    return { items: fresh.map(reportView) };
  });
}

type ReserveRun = { row: HomeworkGradingReportRow; shouldRun: boolean };
async function reserveAnalysis(actorId: string, draftId: string, reportId: string, db: PrismaClient): Promise<ReserveRun> {
  return transaction(db, async (tx): Promise<ReserveRun> => {
    const row = await ownedReport(tx, actorId, draftId, reportId);
    if (row.draft.state !== 'CONFIRMED') conflict('作业已归档，不能启动新的批改分析');
    if (row.state === 'RUNNING' && row.leaseExpiresAt && row.leaseExpiresAt <= new Date()) {
      const failed = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: { state: 'FAILED', errorCode: 'GRADING_EXPIRED', leaseExpiresAt: null, revision: { increment: 1 } } });
      return { row: failed, shouldRun: false };
    }
    if (row.state !== 'PENDING') return { row, shouldRun: false };
    const snapshot = parseSnapshot(row.snapshot);
    if (sourceDigest(draftId, row.sourceRevision, snapshot.draftDigest, snapshot.questions) !== row.sourceDigest || inputChars(snapshot.questions) > MAX_GRADING_INPUT_CHARS) {
      const failed = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: { state: 'FAILED', errorCode: 'SCHEMA_INVALID', revision: { increment: 1 } } });
      return { row: failed, shouldRun: false };
    }
    const running = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: { state: 'RUNNING', errorCode: null, leaseExpiresAt: new Date(Date.now() + GRADING_LEASE_MS), revision: { increment: 1 } } });
    return { row: running, shouldRun: true };
  });
}

function relaySignal(internal: AbortController, external?: AbortSignal): () => void {
  const abort = (): void => internal.abort();
  if (external?.aborted) abort(); else external?.addEventListener('abort', abort, { once: true });
  return (): void => external?.removeEventListener('abort', abort);
}

async function finishAnalysis(actorId: string, draftId: string, reportId: string, state: 'READY' | 'FAILED' | 'CANCELLED', result: HomeworkGradingResult | null, code: z.infer<typeof safeGradingErrorCodeSchema> | null, db: PrismaClient): Promise<HomeworkGradingReport> {
  return transaction(db, async (tx): Promise<HomeworkGradingReport> => {
    const row = await ownedReport(tx, actorId, draftId, reportId, true);
    if (row.state !== 'RUNNING') return reportView(row);
    if (row.draft.state !== 'CONFIRMED') {
      const archived = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: { state: 'CANCELLED', result: Prisma.JsonNull, errorCode: 'CANCELLED', leaseExpiresAt: null, revision: { increment: 1 } } });
      return reportView(archived);
    }
    const updated = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: {
      state, result: result ? result as unknown as Prisma.InputJsonValue : undefined,
      errorCode: code, leaseExpiresAt: null, revision: { increment: 1 },
    } });
    await recordAudit({ actorId, objectId: row.id, action: `homework.grading.${state.toLowerCase()}` }, tx);
    return reportView(updated);
  });
}

export async function runHomeworkGradingReport(actorId: string, draftId: string, reportId: string, signal?: AbortSignal, db: PrismaClient = prisma, evaluate: typeof evaluateHomeworkQuestions = evaluateHomeworkQuestions): Promise<HomeworkGradingReport> {
  const reserved = await reserveAnalysis(actorId, draftId, reportId, db);
  if (!reserved.shouldRun) return reportView(reserved.row);
  const controller = new AbortController();
  const removeAbort = relaySignal(controller, signal);
  const key = `analysis:${reportId}`;
  inflight.set(key, controller);
  try {
    const snapshot = parseSnapshot(reserved.row.snapshot);
    const result = await evaluate(snapshot.questions, controller.signal);
    return await finishAnalysis(actorId, draftId, reportId, 'READY', result, null, db);
  } catch (error) {
    const code = errorCode(error, controller.signal.aborted);
    return await finishAnalysis(actorId, draftId, reportId, code === 'CANCELLED' ? 'CANCELLED' : 'FAILED', null, code, db);
  } finally {
    removeAbort();
    if (inflight.get(key) === controller) inflight.delete(key);
  }
}

async function applyCancel(actorId: string, draftId: string, reportId: string, command: Extract<ReportCommand, { action: 'cancel' }>, db: PrismaClient): Promise<{ report: HomeworkGradingReport; abortKey: string | null }> {
  const digest = operationDigest(reportId, command);
  return transaction(db, async (tx): Promise<{ report: HomeworkGradingReport; abortKey: string | null }> => {
    const row = await ownedReport(tx, actorId, draftId, reportId, true);
    const operations = parseOperations(row.operations as Prisma.JsonValue);
    const prior = operations.find((operation): boolean => operation.id === command.requestId);
    if (prior) { if (prior.digest !== digest) conflict('该请求编号已用于其它取消操作'); return { report: reportView(row), abortKey: null }; }
    if (row.revision !== command.expectedRevision) conflict();
    if (operations.length >= MAX_GRADING_OPERATIONS) conflict('本报告已达到操作次数上限');
    let state = row.state;
    let error = row.errorCode;
    let corrections = parseCorrections(row.corrections as Prisma.JsonValue);
    let abortKey: string | null = null;
    if (command.target === 'analysis') {
      if (row.state === 'PENDING' || row.state === 'RUNNING') { state = 'CANCELLED'; error = 'CANCELLED'; abortKey = `analysis:${reportId}`; }
      else if (row.state !== 'CANCELLED') conflict('当前批改已结束，不能再取消');
    } else {
      const target = command.targetRequestId;
      const index = corrections.findIndex((item): boolean => item.requestId === target);
      if (index < 0) missing();
      const item = corrections[index];
      if (item.state === 'RUNNING') {
        corrections[index] = { ...item, state: 'CANCELLED', errorCode: 'CANCELLED', completedAt: new Date().toISOString() };
        abortKey = `correction:${reportId}:${item.requestId}`;
      } else if (item.state !== 'CANCELLED') conflict('该订正复核已结束，不能再取消');
    }
    const updated = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: {
      state, errorCode: error, corrections: corrections as unknown as Prisma.InputJsonValue,
      operations: [...operations, { id: command.requestId, digest }] as unknown as Prisma.InputJsonValue,
      leaseExpiresAt: state === 'CANCELLED' ? null : row.leaseExpiresAt,
      revision: { increment: 1 },
    } });
    await recordAudit({ actorId, objectId: row.id, action: 'homework.grading.cancel' }, tx);
    return { report: reportView(updated), abortKey };
  });
}

type CorrectionStart = { row: HomeworkGradingReportRow; attempt: StoredCorrection | null; shouldRun: boolean };
async function reserveCorrection(actorId: string, draftId: string, reportId: string, command: Extract<ReportCommand, { action: 'correct' }>, db: PrismaClient): Promise<CorrectionStart> {
  const digest = operationDigest(reportId, command);
  return transaction(db, async (tx): Promise<CorrectionStart> => {
    const row = await ownedReport(tx, actorId, draftId, reportId, true);
    if (row.draft.state !== 'CONFIRMED') conflict('作业已归档，不能启动新的订正复核');
    const operations = parseOperations(row.operations as Prisma.JsonValue);
    const prior = operations.find((operation): boolean => operation.id === command.requestId);
    if (prior) {
      if (prior.digest !== digest) conflict('该请求编号已用于其它订正内容');
      const attempt = parseCorrections(row.corrections as Prisma.JsonValue).find((item): boolean => item.requestId === command.requestId) ?? null;
      return { row, attempt, shouldRun: false };
    }
    if (row.revision !== command.expectedRevision) conflict();
    if (row.state !== 'READY' || !parseResult(row.result)) conflict('请先完成本批次AI分析');
    const corrections = parseCorrections(row.corrections as Prisma.JsonValue);
    if (operations.length >= MAX_GRADING_OPERATIONS || corrections.length >= MAX_CORRECTIONS_PER_REPORT) conflict('本报告已达到订正操作上限');
    if (corrections.some((item): boolean => item.state === 'RUNNING')) conflict('请先完成或取消当前订正复核');
    const snapshot = parseSnapshot(row.snapshot);
    const question = snapshot.questions.find((candidate): boolean => candidate.number === command.number);
    if (!question) missing();
    if (command.answer === question.answer) conflict('订正内容与原答案相同，请修改后再核对');
    const previousSame = [...corrections].reverse().find((item): boolean => item.number === command.number && item.correctedAnswer === command.answer);
    if (previousSame?.state === 'READY') conflict('这份订正已完成复核，无需重复提交');
    const previous = [...corrections].reverse().find((item): boolean => item.number === command.number);
    const attempt: StoredCorrection = {
      requestId: command.requestId, digest, number: question.number,
      beforeAnswer: previous?.correctedAnswer ?? question.answer, correctedAnswer: command.answer,
      state: 'RUNNING', result: null, errorCode: null, createdAt: new Date().toISOString(), completedAt: null,
    };
    const updated = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: {
      corrections: [...corrections, attempt] as unknown as Prisma.InputJsonValue,
      operations: [...operations, { id: command.requestId, digest }] as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
    } });
    await recordAudit({ actorId, objectId: row.id, action: 'homework.grading.correct' }, tx);
    return { row: updated, attempt, shouldRun: true };
  });
}

async function finishCorrection(actorId: string, draftId: string, reportId: string, requestId: string, state: 'READY' | 'FAILED' | 'CANCELLED', result: HomeworkGradingItem | null, code: z.infer<typeof safeGradingErrorCodeSchema> | null, db: PrismaClient): Promise<HomeworkGradingReport> {
  return transaction(db, async (tx): Promise<HomeworkGradingReport> => {
    const row = await ownedReport(tx, actorId, draftId, reportId, true);
    const corrections = parseCorrections(row.corrections as Prisma.JsonValue);
    const index = corrections.findIndex((item): boolean => item.requestId === requestId);
    if (index < 0) missing();
    if (corrections[index].state !== 'RUNNING') return reportView(row);
    const archived = row.draft.state !== 'CONFIRMED';
    const finalState = archived ? 'CANCELLED' : state;
    corrections[index] = { ...corrections[index], state: finalState, result: archived ? null : result, errorCode: archived ? 'CANCELLED' : code, completedAt: new Date().toISOString() };
    const updated = await tx.homeworkGradingReport.update({ where: { id: row.id }, data: { corrections: corrections as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
    await recordAudit({ actorId, objectId: row.id, action: `homework.grading.correction_${finalState.toLowerCase()}` }, tx);
    return reportView(updated);
  });
}

async function runCorrection(actorId: string, draftId: string, reportId: string, attempt: StoredCorrection, signal?: AbortSignal, db: PrismaClient = prisma): Promise<HomeworkGradingReport> {
  const row = await db.homeworkGradingReport.findUnique({ where: { id: reportId } });
  if (!row || row.draftId !== draftId) missing();
  const snapshot = parseSnapshot(row.snapshot);
  const question = snapshot.questions.find((candidate): boolean => candidate.number === attempt.number);
  if (!question) missing();
  const controller = new AbortController();
  const removeAbort = relaySignal(controller, signal);
  const key = `correction:${reportId}:${attempt.requestId}`;
  inflight.set(key, controller);
  try {
    const result = await evaluateHomeworkCorrection(question, attempt.correctedAnswer, controller.signal);
    const item = result.items[0];
    if (!item) throw new AiError('订正复核没有返回本题结果', 'SCHEMA_INVALID', 502);
    return await finishCorrection(actorId, draftId, reportId, attempt.requestId, 'READY', item, null, db);
  } catch (error) {
    const code = errorCode(error, controller.signal.aborted);
    return await finishCorrection(actorId, draftId, reportId, attempt.requestId, code === 'CANCELLED' ? 'CANCELLED' : 'FAILED', null, code, db);
  } finally {
    removeAbort();
    if (inflight.get(key) === controller) inflight.delete(key);
  }
}

export async function commandHomeworkGradingReport(actorId: string, draftId: string, reportId: string, raw: unknown, signal?: AbortSignal, db: PrismaClient = prisma): Promise<HomeworkGradingReport> {
  const command = checked(reportCommandSchema, raw, '订正/取消请求不合法，请重新读取本报告');
  if (command.action === 'cancel') {
    const cancelled = await applyCancel(actorId, draftId, reportId, command, db);
    if (cancelled.abortKey) inflight.get(cancelled.abortKey)?.abort();
    return cancelled.report;
  }
  const reserved = await reserveCorrection(actorId, draftId, reportId, command, db);
  if (!reserved.shouldRun || !reserved.attempt) return reportView(reserved.row);
  return runCorrection(actorId, draftId, reportId, reserved.attempt, signal, db);
}

export async function listHomeworkMistakes(actorId: string, db: PrismaClient = prisma): Promise<HomeworkMistakeList> {
  return transaction(db, async (tx): Promise<HomeworkMistakeList> => {
    studentRole((await account(tx, actorId)).role);
    const rows = await tx.homeworkGradingReport.findMany({
      where: { state: 'READY', draft: { is: { ownerId: actorId } } },
      include: { draft: { select: { id: true, title: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200,
    });
    const seen = new Set<string>();
    const items: HomeworkMistakeItem[] = [];
    for (const row of rows) {
      const snapshot = snapshotSchema.safeParse(row.snapshot);
      const result = snapshot.success ? parseResult(row.result, snapshot.data.questions) : null;
      if (!snapshot.success || !result) continue;
      const corrections = parseCorrections(row.corrections as Prisma.JsonValue);
      for (const grade of result.items) {
        const key = `${row.draftId}:${grade.number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const question = snapshot.data.questions.find((candidate): boolean => candidate.number === grade.number);
        if (!question) continue;
        const latest = [...corrections].reverse().find((item): boolean => item.number === grade.number);
        const current = latest?.result ?? grade;
        if (latest?.state === 'READY' && latest.result?.assessment === 'correct') continue;
        if (!['partial', 'incorrect', 'needs_review'].includes(current.assessment)) continue;
        items.push({
          draftId: row.draftId, draftTitle: row.draft.title, reportId: row.id, number: grade.number,
          question: question.prompt, answer: latest?.correctedAnswer ?? question.answer,
          assessment: current.assessment as HomeworkMistakeItem['assessment'], errorCause: current.errorCause,
          reason: current.reason, updatedAt: latest?.completedAt ?? row.createdAt.toISOString(),
        });
      }
    }
    return { items: items.slice(0, 50) };
  });
}
