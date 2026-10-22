import { z } from 'zod';
import { examTrackSchema, type AttemptQuestion } from './contracts';
export const examListQuery = z.object({ q: z.string().trim().max(120).default(''), track: examTrackSchema.optional(), subjectId: z.string().trim().min(1).max(128).optional(), kind: z.enum(['OFFICIAL', 'MOCK', 'AI_MOCK']).optional(), year: z.coerce.number().int().min(1900).max(2200).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const startExamSchema = z.object({ expectedVersionId: z.string().trim().min(1).max(128), requestId: z.string().uuid(), confirmed: z.literal(true) }).strict();
export const saveExamAnswerSchema = z.object({ paperItemId: z.string().min(1).max(128), answer: z.union([z.string().max(10000), z.array(z.string().min(1).max(32)).max(8), z.boolean(), z.null()]), marked: z.boolean(), expectedRevision: z.number().int().min(0).max(2147483646), requestId: z.string().uuid() }).strict();
export const submitExamSchema = z.object({ expectedRevision: z.number().int().min(0).max(2147483646), requestId: z.string().uuid() }).strict();
export type SaveExamAnswer = z.infer<typeof saveExamAnswerSchema>;
export type SubmitExam = z.infer<typeof submitExamSchema>;
export type ExamGradeSummary = { objectiveScoreUnits: number; pendingScoreUnits: number; finalScoreUnits: number | null; submittedAt: string };
export type SaveExamResult = { revision: number; paperItemId: string; answerRevision: number };
export type SubmitExamResult = { revision: number; state: 'PENDING_REVIEW' | 'GRADED'; gradeSummary: ExamGradeSummary };
export type StartExam = z.infer<typeof startExamSchema>;
export type ExamSourceSummary = { kind: 'OFFICIAL_PUBLIC' | 'AUTHORIZED_IMPORT' | 'AUTHORED' | 'AI_GENERATED'; name: string; sourceYear: number | null; edition: string | null; questionCount: number };
export type ExamSectionSummary = { id: string; title: string; type: AttemptQuestion['type']; questionCount: number; scorePerQuestionUnits: number };
export type ExamSummary = { id: string; versionId: string; versionNo: number; title: string; description: string; subjectId: string; subjectName: string; track: z.infer<typeof examTrackSchema>; kind: 'OFFICIAL' | 'MOCK' | 'AI_MOCK'; sourceYear: number | null; sourceYears: number[]; questionCount: number; totalScoreUnits: number; durationSec: number; availability: 'AVAILABLE' };
export type ExamDetail = ExamSummary & { referenceOnly?: boolean; sections: ExamSectionSummary[]; sources: ExamSourceSummary[]; ongoingAttempt: AttemptSummary | null };
export type ExamList = { page: number; pageSize: number; total: number; items: ExamSummary[]; subjects: { id: string; name: string; track: ExamSummary['track'] }[] };
export type AttemptSummary = { attemptId: string; paperId: string; versionId: string; versionNo: number; title: string; state: 'IN_PROGRESS' | 'SUBMITTED' | 'PENDING_REVIEW' | 'GRADED'; revision: number; startedAt: string; deadlineAt: string; serverNow: string; expired: boolean; referenceOnly: boolean; questionCount: number; totalScoreUnits: number };
export type SavedExamAnswer = { paperItemId: string; answer: string | string[] | boolean | null; marked: boolean; revision: number };
export type StudentAttempt = AttemptSummary & { sections: (ExamSectionSummary & { questionIds: string[] })[]; questions: AttemptQuestion[]; savedAnswers: SavedExamAnswer[]; gradeSummary?: ExamGradeSummary };

/** A source as shown back to the learner/admin: never the private url/rights/checkedAt. */
export type ExamSourceReview = { kind: 'OFFICIAL_PUBLIC' | 'AUTHORIZED_IMPORT' | 'AUTHORED' | 'AI_GENERATED'; name: string; sourceYear: number | null; edition: string | null };
/** One question as revealed after submission: the learner's own answer, the sealed correct answer, explanation, and pending/graded state. */
export type ExamResultQuestion = {
  paperItemId: string;
  stem: string;
  options: { key: string; text: string }[];
  sequence: number;
  type: AttemptQuestion['type'];
  maxScoreUnits: number;
  ownAnswer: SavedExamAnswer['answer'];
  /** Objective: true/false; subjective: always null (scored separately). */
  correct: boolean | null;
  /** Objective: 0..max; subjective: null until a human grades it. */
  scoreUnits: number | null;
  /** Subjective answer not yet graded by a human. */
  pending: boolean;
  /** The sealed correct key/boolean/reference answer, only revealed after submission. */
  correctAnswer: string | string[] | boolean;
  explanation: string;
  /** Human grader feedback, present only after a subjective question has been graded. */
  feedback?: string;
  /** Wrong-answer flag for the 错题 (mistake review) list. */
  isWrong: boolean;
  source: ExamSourceReview;
};
export type ExamResultTypeStat = { type: AttemptQuestion['type']; total: number; correct: number; wrong: number; pending: number; scoredUnits: number; maxUnits: number };
export type ExamAttemptResult = AttemptSummary & {
  gradeSummary: ExamGradeSummary;
  typeStats: ExamResultTypeStat[];
  questions: ExamResultQuestion[];
  wrongCount: number;
  sourceReview: ExamSourceReview[];
};
/** Admin-submitted subjective grades for one attempt. */
export const gradeExamSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  requestId: z.string().uuid(),
  grades: z.array(z.object({ paperItemId: z.string().min(1).max(128), scoreUnits: z.number().int().min(0).max(1000000), feedback: z.string().trim().max(10000).default('') }).strict()).min(1).max(200),
}).strict().superRefine((value, ctx): void => {
  if (new Set(value.grades.map((grade): string => grade.paperItemId)).size !== value.grades.length) ctx.addIssue({ code: 'custom', path: ['grades'], message: '同一批阅不能重复指定题目' });
});
export type GradeExam = z.infer<typeof gradeExamSchema>;
export type GradeExamGraded = { paperItemId: string; scoreUnits: number; feedback: string };
export type GradeExamResult = { revision: number; state: 'PENDING_REVIEW' | 'GRADED'; gradeSummary: ExamGradeSummary; graded: GradeExamGraded[] };

/** Reads only student-authored values, never a stored scoring object. */
export function ownAnswer(value: unknown): SavedExamAnswer['answer'] {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= 10000) return value;
  if (Array.isArray(value) && value.length <= 8 && value.every((item): boolean => typeof item === 'string' && item.length <= 32)) return value as string[];
  return null;
}
