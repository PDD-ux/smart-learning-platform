import { describe, expect, it } from 'vitest';
import { examListQuery, gradeExamSchema, ownAnswer, startExamSchema } from '@/lib/exams/student-contracts';
describe('student exam boundaries', () => {
  it('accepts real source year filters and rejects forged visibility/ownership/invalid pagination', () => {
    expect(examListQuery.parse({ year: '2025', track: 'UNIVERSITY' })).toMatchObject({ year: 2025, page: 1, pageSize: 20 });
    for (const value of [{ year: 'now' }, { year: 1899 }, { page: 0 }, { pageSize: 51 }, { visibility: 'PRIVATE' }, { ownerId: 'other' }, { track: 'invented' }]) expect(examListQuery.safeParse(value).success).toBe(false);
  });
  it('requires a confirmed version-bound UUID and rejects clocks, scores, keys and unknown fields', () => {
    const input = { expectedVersionId: 'v', requestId: '00000000-0000-4000-8000-000000000000', confirmed: true };
    expect(startExamSchema.safeParse(input).success).toBe(true);
    for (const change of [{ confirmed: false }, { expectedVersionId: '' }, { requestId: 'invalid' }, { deadlineAt: '2099-01-01' }, { scoreUnits: 100 }, { correctAnswer: 'A' }, { questionOrder: ['x'] }, { learnerId: 'other' }]) expect(startExamSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it('projects only simple learner answer values and drops arbitrary scoring objects', () => {
    for (const value of [null, true, false, 'A', '本人回答', ['A', 'B']]) expect(ownAnswer(value)).toEqual(value);
    for (const value of [{ correctAnswer: 'secret', explanation: 'secret' }, { text: 'secret' }, 10, [1], ['x'.repeat(33)], Array(9).fill('A'), 'x'.repeat(10001), undefined]) expect(ownAnswer(value)).toBeNull();
  });
  it('accepts only bounded manual grades behind a UUID idempotency key and rejects scoring/answer injection', () => {
    const requestId = '00000000-0000-4000-8000-000000000000';
    const input = { expectedRevision: 3, requestId, grades: [{ paperItemId: 'i1', scoreUnits: 80, feedback: '要点完整' }] };
    expect(gradeExamSchema.parse(input)).toMatchObject({ expectedRevision: 3, grades: [{ paperItemId: 'i1', scoreUnits: 80, feedback: '要点完整' }] });
    expect(gradeExamSchema.parse({ ...input, grades: [{ paperItemId: 'i1', scoreUnits: 0 }] }).grades[0].feedback).toBe('');
    for (const change of [
      { expectedRevision: -1 }, { expectedRevision: 1.5 }, { requestId: 'not-a-uuid' },
      { grades: [] }, { grades: Array(201).fill({ paperItemId: 'i1', scoreUnits: 1 }) }, { grades: [{ paperItemId: '', scoreUnits: 1 }] },
      { grades: [{ paperItemId: 'i1', scoreUnits: -1 }] }, { grades: [{ paperItemId: 'i1', scoreUnits: 1000001 }] },
      { grades: [{ paperItemId: 'i1', scoreUnits: 80, feedback: 'x'.repeat(10001) }] },
      { grades: [{ paperItemId: 'i1', scoreUnits: 80, correctAnswer: 'A' }] }, { grades: [{ paperItemId: 'i1', scoreUnits: 80, correct: true }] },
      { grades: [{ paperItemId: 'i1', scoreUnits: 80, gradedAt: '2099-01-01T00:00:00.000Z' }] }, { grades: [{ paperItemId: 'i1', scoreUnits: 80, finalScoreUnits: 100 }] },
      { grades: [{ paperItemId: 'i1', scoreUnits: 80, graderId: 'someone' }] },
    ]) expect(gradeExamSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
});
