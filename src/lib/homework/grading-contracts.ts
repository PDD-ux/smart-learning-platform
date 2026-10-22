import { z } from 'zod';

export const MAX_GRADING_QUESTIONS = 8;
export const MAX_GRADING_INPUT_CHARS = 16_000;
export const MAX_GRADING_REPORTS_PER_DRAFT = 40;
export const MAX_GRADING_REPORTS_READ = 20;
export const MAX_CORRECTIONS_PER_REPORT = 50;
export const MAX_GRADING_OPERATIONS = 100;
export const GRADING_LEASE_MS = 120_000;

export const assessmentSchema = z.enum(['correct', 'partial', 'incorrect', 'needs_review']);
export const errorCauseSchema = z.enum(['none', 'concept', 'method', 'calculation', 'omission', 'expression', 'uncertainty']);
export const safeGradingErrorCodeSchema = z.enum(['AI_UNAVAILABLE', 'AI_TIMEOUT', 'SCHEMA_INVALID', 'CANCELLED', 'GRADING_EXPIRED']);

export const gradingCandidateFieldsSchema = z.object({
  number: z.string().trim().min(1).max(20),
  assessment: assessmentSchema,
  suggestedScore: z.number().int().min(0).max(100).nullable(),
  errorCause: errorCauseSchema,
  reason: z.string().trim().min(4).max(500),
  evidenceQuote: z.string().max(160),
  nextStep: z.string().trim().min(2).max(300),
}).strict();
export const gradingCandidateSchema = gradingCandidateFieldsSchema.superRefine((item, ctx): void => {
  if (item.assessment === 'needs_review' && (item.suggestedScore !== null || item.errorCause !== 'uncertainty')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '待核验结果必须无建议分并标记不确定' });
  }
  if (item.assessment !== 'needs_review' && (item.suggestedScore === null || item.errorCause === 'uncertainty' || !item.evidenceQuote.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '确定性建议必须有分数、错因类别和依据摘录' });
  }
});

export const reportCreateSchema = z.object({
  requestId: z.string().uuid(),
  expectedDraftRevision: z.number().int().positive(),
  consent: z.literal(true),
  questionNumbers: z.array(z.string().trim().min(1).max(20)).min(1).max(MAX_GRADING_QUESTIONS),
}).strict().refine((value): boolean => new Set(value.questionNumbers).size === value.questionNumbers.length, '题号不能重复');
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

const commandFields = { requestId: z.string().uuid(), expectedRevision: z.number().int().positive() };
export const reportCommandSchema = z.union([
  z.object({ ...commandFields, action: z.literal('correct'), consent: z.literal(true), number: z.string().trim().min(1).max(20), answer: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ ...commandFields, action: z.literal('cancel'), target: z.enum(['analysis', 'correction']), targetRequestId: z.string().uuid().optional() }).strict(),
]).superRefine((value, ctx): void => {
  if (value.action !== 'cancel') return;
  if (value.target === 'correction' && !value.targetRequestId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '取消订正复核必须指定请求编号' });
  if (value.target === 'analysis' && value.targetRequestId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '分析取消不能指定订正编号' });
});
export type ReportCommand = z.infer<typeof reportCommandSchema>;

export type HomeworkGradingItem = z.infer<typeof gradingCandidateSchema> & {
  objectiveMatch: 'match' | 'mismatch' | 'unavailable';
  objectiveScore: 0 | 100 | null;
};
export type HomeworkGradingResult = { items: HomeworkGradingItem[] };
export type HomeworkCorrectionAttempt = {
  requestId: string;
  number: string;
  beforeAnswer: string;
  correctedAnswer: string;
  state: 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED';
  result: HomeworkGradingItem | null;
  errorCode: z.infer<typeof safeGradingErrorCodeSchema> | null;
  createdAt: string;
  completedAt: string | null;
};
export type HomeworkGradingReport = {
  id: string;
  requestId: string;
  state: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED';
  revision: number;
  sourceRevision: number;
  questionNumbers: string[];
  result: HomeworkGradingResult | null;
  corrections: HomeworkCorrectionAttempt[];
  errorCode: z.infer<typeof safeGradingErrorCodeSchema> | null;
  createdAt: string;
  updatedAt: string;
};
export type HomeworkMistakeItem = {
  draftId: string;
  draftTitle: string;
  reportId: string;
  number: string;
  question: string;
  answer: string;
  assessment: 'partial' | 'incorrect' | 'needs_review';
  errorCause: z.infer<typeof errorCauseSchema>;
  reason: string;
  updatedAt: string;
};
export type HomeworkMistakeList = { items: HomeworkMistakeItem[] };
