import { describe, expect, it } from 'vitest';
import { validExamAnswer, scoreExamAnswer, hasExamAnswer } from '@/lib/exams/attempt-scoring';
import { saveExamAnswerSchema, submitExamSchema, gradeExamSchema } from '@/lib/exams/student-contracts';
import type { ExamQuestionBody } from '@/lib/exams/contracts';
const single: ExamQuestionBody = { type: 'SINGLE_CHOICE', stem: 'test', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], correctOptionKeys: ['B'], explanation: '' };
const multi: ExamQuestionBody = { ...single, type: 'MULTIPLE_CHOICE', correctOptionKeys: ['A', 'B'] };
describe('frozen exam scoring', () => {
  it('rejects repeated item IDs within one grade request', () => { const grade = { paperItemId: 'q', scoreUnits: 0, feedback: '' }; expect(gradeExamSchema.safeParse({ expectedRevision: 1, requestId: 'a9ab1dfb-84c4-4635-8135-154aa6766332', grades: [grade, grade] }).success).toBe(false); });
  it('scores by stable keys with integer units, never visual option position', () => { expect(scoreExamAnswer(single, 'B', 125)).toEqual({ correct: true, scoreUnits: 125 }); expect(scoreExamAnswer(single, 'A', 125)?.scoreUnits).toBe(0); });
  it.each([null, [], ['A'], ['B'], ['A', 'B', 'C'], ['A', 'A']])('gives no partial multiple-choice credit for %j', (answer) => { expect(scoreExamAnswer(multi, answer, 500)?.scoreUnits).toBe(0); });
  it('accepts the exact set regardless of order', () => { expect(scoreExamAnswer(multi, ['B', 'A'], 500)?.scoreUnits).toBe(500); });
  it('keeps blank and false distinct, including subjective pending', () => { const body: ExamQuestionBody = { type: 'TRUE_FALSE', stem: 'test', options: [], correctBoolean: false, explanation: '' }; expect(scoreExamAnswer(body, false, 100)?.scoreUnits).toBe(100); expect(scoreExamAnswer(body, null, 100)?.scoreUnits).toBe(0); expect(hasExamAnswer(false)).toBe(true); expect(hasExamAnswer('  ')).toBe(false); expect(scoreExamAnswer({ type: 'SUBJECTIVE', stem: 'why', options: [], referenceAnswer: 'secret', rubric: 'secret', explanation: '' }, null, 100)).toBeNull(); });
  it('rejects wrong shapes, duplicate/foreign keys and client grading injection', () => { expect(validExamAnswer(single, ['A'])).toBe(false); expect(validExamAnswer(single, 'C')).toBe(false); expect(validExamAnswer(multi, ['A', 'A'])).toBe(false); const base = { paperItemId: 'q', answer: 'B', marked: false, expectedRevision: 0, requestId: 'a9ab1dfb-84c4-4635-8135-154aa6766332' }; expect(saveExamAnswerSchema.safeParse(base).success).toBe(true); expect(saveExamAnswerSchema.safeParse({ ...base, scoreUnits: 100 }).success).toBe(false); expect(submitExamSchema.safeParse({ requestId: base.requestId, expectedRevision: 0, answer: 'B' }).success).toBe(false); });
});
