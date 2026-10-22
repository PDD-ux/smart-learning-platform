import { describe, expect, it } from 'vitest';
import { canReadExam, canTransitionExamAttempt, canTransitionExamGeneration, examBlueprintSchema, examGradeSummarySchema, examSourceSchema, questionBodySchema, toAttemptQuestion } from '@/lib/exams/contracts';

const body = { type: 'SINGLE_CHOICE' as const, stem: '定义域指什么？', options: [{ key: 'input', text: '输入集合' }, { key: 'output', text: '输出集合' }], correctOptionKeys: ['input'], explanation: '定义域是输入集合。' };
const blueprint = { title: '模拟卷', track: 'UNIVERSITY', subjectId: 'math', mode: 'AI_SUBJECT', durationSec: 1200, totalScoreUnits: 10000,
  sections: [{ key: 'choices', title: '单选', type: 'SINGLE_CHOICE', questionCount: 20, scorePerQuestionUnits: 500 }] };

describe('exam question contracts', () => {
  it('uses stable answer keys and rejects duplicate/placeholder options and nonexistent answers', () => {
    const parsed = questionBodySchema.parse(body);
    expect(parsed.type).toBe('SINGLE_CHOICE');
    if (parsed.type === 'SINGLE_CHOICE') expect(parsed.correctOptionKeys).toEqual(['input']);
    for (const change of [{ correctOptionKeys: ['absent'] }, { correctOptionKeys: ['input', 'output'] }, { options: [{ key: 'input', text: 'A' }, body.options[1]] },
      { options: [body.options[0], { key: 'output', text: ' 输 入 集 合 ' }] }, { options: [body.options[0], { key: 'input', text: '其他内容' }] }, { score: 100 }]) {
      expect(questionBodySchema.safeParse({ ...body, ...change }).success).toBe(false);
    }
  });
  it('keeps multi-choice, boolean and subjective answer forms separate', () => {
    expect(questionBodySchema.safeParse({ ...body, type: 'MULTIPLE_CHOICE', correctOptionKeys: ['input', 'output'] }).success).toBe(true);
    expect(questionBodySchema.safeParse({ ...body, type: 'MULTIPLE_CHOICE' }).success).toBe(false);
    expect(questionBodySchema.safeParse({ type: 'TRUE_FALSE', stem: '这是陈述。', explanation: '依据', options: [], correctBoolean: false }).success).toBe(true);
    expect(questionBodySchema.safeParse({ type: 'SUBJECTIVE', stem: '解释原因', explanation: '', options: [], referenceAnswer: '参考作答', rubric: '说明必要条件' }).success).toBe(true);
    expect(questionBodySchema.safeParse({ ...body, type: 'SUBJECTIVE' }).success).toBe(false);
  });
  it('projects only public attempt fields even when private source or answer fields exist at runtime', () => {
    const dto = toAttemptQuestion({ id: 'i1', sequence: 0, scoreUnits: 250, body: { ...body, referenceAnswer: 'secret', source: 'private-source' } } as Parameters<typeof toAttemptQuestion>[0]);
    expect(Object.keys(dto).sort()).toEqual(['id', 'options', 'scoreUnits', 'sequence', 'stem', 'type']);
    for (const value of ['correctOptionKeys', 'explanation', 'secret', 'private-source']) expect(JSON.stringify(dto)).not.toContain(value);
  });
});

describe('exam blueprint and source', () => {
  it('defaults to twenty and verifies exact count/score and AI limits without silently truncating', () => {
    expect(examBlueprintSchema.parse(blueprint).requestedCount).toBe(20);
    for (const change of [{ requestedCount: 5 }, { totalScoreUnits: 9999 }, { requestedCount: 51 }, { durationSec: 0 }, { contentId: 'unauthorized' }, { chapterIds: ['c', 'c'] }, { state: 'READY' }]) {
      expect(examBlueprintSchema.safeParse({ ...blueprint, ...change }).success).toBe(false);
    }
    expect(examBlueprintSchema.safeParse({ ...blueprint, mode: 'BANK', requestedCount: 200, sections: [{ ...blueprint.sections[0], questionCount: 200, scorePerQuestionUnits: 50 }] }).success).toBe(true);
    expect(examBlueprintSchema.safeParse({ ...blueprint, mode: 'AI_SOURCE' }).success).toBe(false);
    expect(examBlueprintSchema.safeParse({ ...blueprint, mode: 'AI_SOURCE', contentId: 'owned' }).success).toBe(true);
  });
  it('does not label AI questions with official years or URLs and rejects credential URLs', () => {
    const source = { kind: 'AI_GENERATED', name: '模型模拟', rightsStatement: '本人模拟练习' };
    expect(examSourceSchema.parse(source).sourceYear).toBeNull();
    expect(examSourceSchema.safeParse({ ...source, sourceYear: 2026 }).success).toBe(false);
    expect(examSourceSchema.safeParse({ ...source, url: 'https://example.org/paper' }).success).toBe(false);
    expect(examSourceSchema.safeParse({ ...source, kind: 'AUTHORIZED_IMPORT', url: 'https://user:secret@example.org' }).success).toBe(false);
    expect(examSourceSchema.safeParse({ ...source, kind: 'AUTHORIZED_IMPORT', url: 'not-a-url' }).success).toBe(false);
    expect(examSourceSchema.safeParse({ ...source, kind: 'AUTHORIZED_IMPORT', url: 'https://example.org/paper', sourceYear: 2025 }).success).toBe(true);
  });
});

describe('exam state and access boundaries', () => {
  it('distinguishes pending subjective scores from a final score and rejects floating or impossible totals', () => {
    const pending = { state: 'PENDING_REVIEW', totalScoreUnits: 10000, objectiveScoreUnits: 4000, pendingScoreUnits: 6000, finalScoreUnits: null };
    expect(examGradeSummarySchema.safeParse(pending).success).toBe(true);
    for (const change of [{ finalScoreUnits: 4000 }, { pendingScoreUnits: 6001 }, { objectiveScoreUnits: 1.5 }]) expect(examGradeSummarySchema.safeParse({ ...pending, ...change }).success).toBe(false);
    expect(examGradeSummarySchema.safeParse({ ...pending, state: 'GRADED', pendingScoreUnits: 0, finalScoreUnits: 8500 }).success).toBe(true);
    expect(examGradeSummarySchema.safeParse({ ...pending, state: 'GRADED', pendingScoreUnits: 0, finalScoreUnits: 3500 }).success).toBe(false);
  });
  it('does not reopen submitted attempts or reset completed/cancelled generation jobs', () => {
    expect(canTransitionExamAttempt('IN_PROGRESS', 'SUBMITTED')).toBe(true);
    expect(canTransitionExamAttempt('GRADED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionExamAttempt('IN_PROGRESS', 'GRADED')).toBe(false);
    expect(canTransitionExamGeneration('INCOMPLETE', 'RUNNING')).toBe(true);
    expect(canTransitionExamGeneration('CANCELLED', 'RUNNING')).toBe(false);
    expect(canTransitionExamGeneration('FAILED', 'QUEUED')).toBe(false);
    expect(canTransitionExamAttempt('toString', 'SUBMITTED')).toBe(false);
    expect(canTransitionExamGeneration('__proto__', 'RUNNING')).toBe(false);
  });
  it('requires a real owner or a public published object with no administrator/private bypass', () => {
    const resource = { ownerId: 'student', visibility: 'PRIVATE' as const, published: false };
    expect(canReadExam('student', resource)).toBe(true);
    expect(canReadExam('admin', resource)).toBe(false);
    expect(canReadExam('admin', { ...resource, ownerId: null })).toBe(false);
    expect(canReadExam('any', { ...resource, visibility: 'PUBLIC', published: true })).toBe(true);
    expect(canReadExam('', { ...resource, visibility: 'PUBLIC', published: true })).toBe(false);
  });
});
