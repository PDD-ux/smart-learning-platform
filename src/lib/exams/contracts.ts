import { z } from 'zod';

export const examTrackSchema = z.enum(['CIVIL_SERVICE', 'POSTGRADUATE', 'UNIVERSITY']);
export const examQuestionTypeSchema = z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SUBJECTIVE']);
const id = z.string().trim().min(1).max(128);
const scoreUnits = z.number().int().min(1).max(1_000_000);
const option = z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), text: z.string().trim().min(1).max(2000) }).strict();
const common = { stem: z.string().trim().min(1).max(10_000), explanation: z.string().trim().max(10_000) };
const choice = { ...common, options: z.array(option).min(2).max(8), correctOptionKeys: z.array(id).min(1).max(8) };
const questionUnion = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SINGLE_CHOICE'), ...choice }).strict(),
  z.object({ type: z.literal('MULTIPLE_CHOICE'), ...choice }).strict(),
  z.object({ type: z.literal('TRUE_FALSE'), ...common, options: z.array(option).length(0), correctBoolean: z.boolean() }).strict(),
  z.object({ type: z.literal('SUBJECTIVE'), ...common, options: z.array(option).length(0), referenceAnswer: z.string().trim().min(1).max(10_000), rubric: z.string().trim().min(1).max(10_000) }).strict(),
]);

function textKey(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}

export const questionBodySchema = questionUnion.superRefine((body, context): void => {
  if (body.type !== 'SINGLE_CHOICE' && body.type !== 'MULTIPLE_CHOICE') return;
  const keys = body.options.map((item): string => item.key);
  const texts = body.options.map((item): string => textKey(item.text).replace(/^[a-h][.、:)\]]/u, ''));
  if (new Set(keys).size !== keys.length || new Set(texts).size !== texts.length
    || texts.some((text): boolean => /^(?:[a-h]|选项[a-h]|待补充|todo|tbd)$/iu.test(text))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '选项须有唯一key和实际且不重复的内容。' });
  }
  if (new Set(body.correctOptionKeys).size !== body.correctOptionKeys.length
    || body.correctOptionKeys.some((key): boolean => !keys.includes(key))
    || (body.type === 'SINGLE_CHOICE' ? body.correctOptionKeys.length !== 1 : body.correctOptionKeys.length < 2)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['correctOptionKeys'], message: '正确答案必须存在且符合单选/多选数量。' });
  }
});
export type ExamQuestionBody = z.infer<typeof questionBodySchema>;

export const examSourceSchema = z.object({
  kind: z.enum(['OFFICIAL_PUBLIC', 'AUTHORIZED_IMPORT', 'AUTHORED', 'AI_GENERATED']),
  name: z.string().trim().min(1).max(300),
  sourceYear: z.number().int().min(1900).max(2200).nullable().default(null),
  edition: z.string().trim().min(1).max(300).nullable().default(null),
  url: z.string().url().max(2000).nullable().default(null),
  rightsStatement: z.string().trim().min(1).max(2000),
  checkedAt: z.string().datetime().nullable().default(null),
}).strict().superRefine((source, context): void => {
  if (source.kind === 'AI_GENERATED' && (source.sourceYear !== null || source.url !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'AI生成不能填写官方题源年份或URL。' });
  }
  if (source.url) {
    try {
      const parsed = new URL(source.url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: '来源链接须为不含凭据的https地址。' });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: '来源链接须为不含凭据的https地址。' });
    }
  }
});

export const examBlueprintSchema = z.object({
  title: z.string().trim().min(1).max(200),
  track: examTrackSchema,
  subjectId: id,
  chapterIds: z.array(id).max(50).default([]),
  mode: z.enum(['BANK', 'AI_SUBJECT', 'AI_SOURCE']),
  contentId: id.optional(),
  targetYear: z.number().int().min(1900).max(2200).nullable().default(null),
  requestedCount: z.number().int().min(1).max(200).default(20),
  durationSec: z.number().int().min(60).max(21600),
  totalScoreUnits: scoreUnits,
  sections: z.array(z.object({ key: id, title: z.string().trim().min(1).max(100), type: examQuestionTypeSchema,
    questionCount: z.number().int().min(1).max(200), scorePerQuestionUnits: scoreUnits }).strict()).min(1).max(20),
}).strict().superRefine((blueprint, context): void => {
  if (blueprint.mode !== 'BANK' && blueprint.requestedCount > 50) context.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedCount'], message: 'AI模拟最多50题。' });
  if ((blueprint.mode === 'AI_SOURCE') !== (blueprint.contentId !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['contentId'], message: '仅本人资料模式必须指定资料。' });
  if (new Set(blueprint.chapterIds).size !== blueprint.chapterIds.length || new Set(blueprint.sections.map((section): string => section.key)).size !== blueprint.sections.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '章节/分区编号不能重复。' });
  }
  if (blueprint.sections.reduce((sum, section): number => sum + section.questionCount, 0) !== blueprint.requestedCount
    || blueprint.sections.reduce((sum, section): number => sum + section.questionCount * section.scorePerQuestionUnits, 0) !== blueprint.totalScoreUnits) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sections'], message: '题型配额和分值必须与整卷目标完全一致。' });
  }
});
export type ExamBlueprint = z.infer<typeof examBlueprintSchema>;

export const examGradeSummarySchema = z.object({
  state: z.enum(['IN_PROGRESS', 'SUBMITTED', 'PENDING_REVIEW', 'GRADED']),
  totalScoreUnits: scoreUnits,
  objectiveScoreUnits: z.number().int().min(0).nullable(),
  pendingScoreUnits: z.number().int().min(0).nullable(),
  finalScoreUnits: z.number().int().min(0).nullable(),
}).strict().superRefine((value, context): void => {
  const { state, totalScoreUnits: total, objectiveScoreUnits: objective, pendingScoreUnits: pending, finalScoreUnits: final } = value;
  const inRange = [objective, pending, final].every((score): boolean => score === null || score <= total);
  const valid = state === 'IN_PROGRESS' || state === 'SUBMITTED' ? objective === null && pending === null && final === null
    : state === 'PENDING_REVIEW' ? objective !== null && pending !== null && pending > 0 && objective + pending <= total && final === null
      : objective !== null && pending === 0 && final !== null && final >= objective;
  if (!inRange || !valid) context.addIssue({ code: z.ZodIssueCode.custom, message: '未批阅不能给最终分，分值不能超出整卷范围。' });
});

/** Database-confirmed ownership/publication facts only; this is not an HTTP authorization middleware. */
export function canReadExam(actorId: string, resource: { ownerId: string | null; visibility: 'PRIVATE' | 'PUBLIC'; published: boolean }): boolean {
  return actorId.trim().length > 0 && (resource.ownerId === actorId || resource.visibility === 'PUBLIC' && resource.published);
}

const attemptTransitions: Record<string, readonly string[]> = {
  IN_PROGRESS: ['SUBMITTED'], SUBMITTED: ['PENDING_REVIEW', 'GRADED'], PENDING_REVIEW: ['GRADED'], GRADED: [],
};
const generationTransitions: Record<string, readonly string[]> = {
  QUEUED: ['RUNNING', 'CANCELLED', 'FAILED'], RUNNING: ['INCOMPLETE', 'READY', 'FAILED', 'CANCELLED'],
  INCOMPLETE: ['RUNNING', 'CANCELLED'], FAILED: ['RUNNING', 'CANCELLED'], READY: [], CANCELLED: [],
};
export function canTransitionExamAttempt(from: string, to: string): boolean { return Object.hasOwn(attemptTransitions, from) && attemptTransitions[from].includes(to); }
export function canTransitionExamGeneration(from: string, to: string): boolean { return Object.hasOwn(generationTransitions, from) && generationTransitions[from].includes(to); }

export type AttemptQuestion = { id: string; sequence: number; scoreUnits: number; type: ExamQuestionBody['type']; stem: string; options: { key: string; text: string }[] };
/** Never spread a Prisma row or a private body into an attempt DTO. */
export function toAttemptQuestion(item: { id: string; sequence: number; scoreUnits: number; body: ExamQuestionBody }): AttemptQuestion {
  return { id: item.id, sequence: item.sequence, scoreUnits: item.scoreUnits, type: item.body.type, stem: item.body.stem,
    options: item.body.options.map((entry): { key: string; text: string } => ({ key: entry.key, text: entry.text })) };
}
