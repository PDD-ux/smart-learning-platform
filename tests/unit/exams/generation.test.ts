import { describe, it, expect } from 'vitest';
import { generationPlanSchema, generationCreateSchema, generationActionSchema, generationSlots, acceptGenerationCandidates, repeatedStem, type GenerationSnapshot } from '@/lib/exams/generation-contracts';
const plan = generationPlanSchema.parse({ blueprint: { title: '练习', track: 'UNIVERSITY', subjectId: 's', mode: 'AI_SUBJECT', requestedCount: 1, durationSec: 600, totalScoreUnits: 100, sections: [{ key: 's', title: '单选', type: 'SINGLE_CHOICE', questionCount: 1, scorePerQuestionUnits: 100 }] }, scope: '基础加法', difficultyMin: 1, difficultyMax: 3 });
const snapshot: GenerationSnapshot = { plan, subjectName: '数学', sources: [], sourceDigest: 'digest', evidenceTruncated: false };
const body = { type: 'SINGLE_CHOICE', stem: '若有两个苹果，再增加三个苹果，总共几个？', options: [{ key: 'A', text: '五个苹果' }, { key: 'B', text: '六个苹果' }], correctOptionKeys: ['A'], explanation: '将两组的数量相加，二加三等于五，所以选择A。' };
const candidate = { position: 0, body, difficulty: 2, evidence: [] };
describe('bounded private generation contracts', () => {
  it('validates count, total, difficulty, modes, scope and strict request fields', () => {
    expect(generationPlanSchema.safeParse({ ...plan, difficultyMin: 4, difficultyMax: 1 }).success).toBe(false);
    expect(generationPlanSchema.safeParse({ ...plan, blueprint: { ...plan.blueprint, requestedCount: 51, mode: 'BANK', totalScoreUnits: 5100, sections: [{ ...plan.blueprint.sections[0], questionCount: 51 }] } }).success).toBe(false);
    expect(generationCreateSchema.safeParse({ plan, requestId: 'a9ab1dfb-84c4-4635-8135-154aa6766332', confirmed: true, usedCalls: 0 }).success).toBe(false);
    expect(generationActionSchema.safeParse({ action: 'retry', expectedRevision: 0, requestId: 'a9ab1dfb-84c4-4635-8135-154aa6766332', deadlineAt: 'new' }).success).toBe(false);
  });
  it('retains fixed positions across many small sections without increasing batch budgets', () => {
    const many = { ...plan, blueprint: { ...plan.blueprint, requestedCount: 20, totalScoreUnits: 2000, sections: Array.from({ length: 20 }, (_, i) => ({ ...plan.blueprint.sections[0], key: String(i) })) } }; const slots = generationSlots(generationPlanSchema.parse(many)); expect(slots.map((slot) => slot.position)).toEqual(Array.from({ length: 20 }, (_, i) => i)); expect(Math.ceil(slots.length / 5)).toBe(4);
  });
  it('derives AI provenance on server and accepts only the requested slot/type', () => {
    const result = acceptGenerationCandidates(JSON.stringify({ questions: [candidate] }), generationSlots(plan), [], snapshot); expect(result.accepted).toHaveLength(1); expect(result.accepted[0].source.kind).toBe('AI_GENERATED'); expect(result.accepted[0].source.sourceYear).toBeNull(); expect(result.accepted[0].source.url).toBeNull();
    for (const bad of [{ ...candidate, position: 1 }, { ...candidate, difficulty: 5 }, { ...candidate, body: { ...body, source: '官方真题' } }, { ...candidate, evidence: [{ id: 'invented', quote: 'invented quote' }] }]) expect(acceptGenerationCandidates(JSON.stringify({ questions: [bad] }), generationSlots(plan), [], snapshot).accepted).toHaveLength(0);
  });
  it('rejects duplicate slots, repeated facts by stem and invalid JSON without partial claims', () => {
    const good = acceptGenerationCandidates(JSON.stringify({ questions: [candidate] }), generationSlots(plan), [], snapshot).accepted;
    expect(acceptGenerationCandidates(JSON.stringify({ questions: [candidate, candidate] }), generationSlots(plan), [], snapshot).accepted).toHaveLength(0);
    expect(acceptGenerationCandidates(JSON.stringify({ questions: [candidate] }), generationSlots(plan), good, snapshot).accepted).toHaveLength(0);
    expect(acceptGenerationCandidates('bad output secret', generationSlots(plan), [], snapshot).failureCode).toBe('INVALID_JSON'); expect(repeatedStem('数量：2 + 3 等于多少？', ['数量2+3等于多少!'])).toBe(true);
  });
  it('requires exact evidence ID and verbatim quote for personal-source mode', () => {
    const sourcePlan = generationPlanSchema.parse({ ...plan, blueprint: { ...plan.blueprint, mode: 'AI_SOURCE', contentId: 'c' } });
    const sourceSnapshot: GenerationSnapshot = { ...snapshot, plan: sourcePlan, sources: [{ id: 'e1', text: '两个苹果加三个苹果等于五个苹果，这是数量相加。', ref: { type: 'document', page: 2 } }] };
    const quote = { id: 'e1', quote: '两个苹果加三个苹果等于五个苹果' };
    expect(acceptGenerationCandidates(JSON.stringify({ questions: [{ ...candidate, evidence: [quote] }] }), generationSlots(sourcePlan), [], sourceSnapshot).accepted[0].evidence[0].ref).toEqual({ type: 'document', page: 2 });
    for (const evidence of [[], [{ ...quote, id: 'other' }], [{ ...quote, quote: '不存在于原文的所谓真实引用' }]]) expect(acceptGenerationCandidates(JSON.stringify({ questions: [{ ...candidate, evidence }] }), generationSlots(sourcePlan), [], sourceSnapshot).accepted).toHaveLength(0);
  });
});
