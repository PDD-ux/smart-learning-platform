import { describe, expect, it } from 'vitest';
import { bankExample } from '@/lib/exams/bank-contracts';
import { paperCommandSchema, paperPlanSchema, selectPaper, type PaperPlan, type PaperCandidate } from '@/lib/exams/paper-contracts';
const section = { key: 'one', title: '选择题', type: 'SINGLE_CHOICE' as const, questionCount: 1, scorePerQuestionUnits: 250, difficultyMin: 1, difficultyMax: 5 };
const plan: PaperPlan = { mode: 'BANK', subjectId: 's', chapterIds: [], title: '模拟卷', description: '', durationSec: 1200, sections: [section] };
function candidate(id: string, difficulty = 1, stem = id): PaperCandidate { return { ...bankExample, id, questionId: 'q-' + id, chapterId: null, difficulty, body: { ...bankExample.body, stem } }; }
describe('bank paper assembly', () => {
  it('uses maximum matching so wide ranges do not steal narrow quota candidates', () => {
    const blueprint = { ...plan, sections: [section, { ...section, key: 'hard', difficultyMin: 5, difficultyMax: 5 }] };
    const result = selectPaper(blueprint, [candidate('hard', 5), candidate('easy', 1)]);
    expect(result.complete).toBe(true); expect(result.selections).toEqual([{ key: 'one', questionVersionIds: ['easy'] }, { key: 'hard', questionVersionIds: ['hard'] }]); expect(result.totalScoreUnits).toBe(500);
  });
  it('deduplicates normalized stems across distinct IDs and counts actual shortages', () => {
    const result = selectPaper({ ...plan, sections: [{ ...section, questionCount: 3 }] }, [candidate('a', 1, 'Same Stem'), candidate('b', 2, 'same　stem'), candidate('c', 3, 'another')]);
    expect(result.complete).toBe(false); expect(result.questionCount).toBe(2); expect(result.sections[0]).toMatchObject({ required: 3, available: 2, missing: 1 }); expect(result.totalScoreUnits).toBe(500);
  });
  it('matches duplicate-stem alternatives to ranges without selecting the same stem twice', () => {
    const result = selectPaper({ ...plan, sections: [section, { ...section, key: 'hard', difficultyMin: 5 }] }, [candidate('duplicate-easy', 1, 'same'), candidate('duplicate-hard', 5, 'same'), candidate('easy-only', 1)]);
    expect(result.complete).toBe(true); expect(result.selections[1].questionVersionIds).toEqual(['duplicate-hard']);
  });
  it('preserves manual order but rejects missing, repeated, wrong-type and out-of-range candidates', () => {
    const blueprint = { ...plan, sections: [{ ...section, questionCount: 2 }] }, candidates = [candidate('a'), candidate('b')];
    expect(selectPaper(blueprint, candidates, [{ key: 'one', questionVersionIds: ['b', 'a'] }]).selections[0].questionVersionIds).toEqual(['b', 'a']);
    for (const ids of [['a'], ['a', 'a'], ['a', 'missing']]) expect(() => selectPaper(blueprint, candidates, [{ key: 'one', questionVersionIds: ids }])).toThrow();
    expect(() => selectPaper({ ...plan, sections: [{ ...section, difficultyMin: 5 }] }, candidates, [{ key: 'one', questionVersionIds: ['a'] }])).toThrow();
    expect(() => selectPaper({ ...plan, sections: [{ ...section, type: 'SUBJECTIVE' }] }, candidates, [{ key: 'one', questionVersionIds: ['a'] }])).toThrow();
  });
  it('bounds quantities, exact hundredth points, unique section keys and stable chapter scope', () => {
    expect(paperPlanSchema.safeParse(plan).success).toBe(true);
    for (const change of [{ sections: [{ ...section, questionCount: 201 }] }, { sections: [{ ...section, scorePerQuestionUnits: 1.2 }] }, { sections: [{ ...section, questionCount: 200, scorePerQuestionUnits: 1000000 }] }, { sections: [section, section] }, { sections: [{ ...section, difficultyMin: 5, difficultyMax: 1 }] }, { chapterIds: ['c', 'c'] }, { kind: 'OFFICIAL' }, { sourceYear: 2026 }, { mode: 'AI_SUBJECT' }]) expect(paperPlanSchema.safeParse({ ...plan, ...change }).success).toBe(false);
  });
  it('does not accept uploaded snapshots or pretend confirmations/versions', () => {
    const command = { action: 'paper.create', plan, selections: [{ key: 'one', questionVersionIds: ['v'] }], previewDigest: 'a'.repeat(64), requestId: '00000000-0000-4000-8000-000000000000', confirmed: true };
    expect(paperCommandSchema.safeParse(command).success).toBe(true);
    for (const change of [{ body: bankExample.body }, { confirmed: false }, { previewDigest: 'changed' }, { requestId: 'invalid' }, { ownerId: 'student' }]) expect(paperCommandSchema.safeParse({ ...command, ...change }).success).toBe(false);
    expect(paperCommandSchema.safeParse({ action: 'paper.publish', id: 'p', requestId: command.requestId, confirmed: true }).success).toBe(false);
  });
});
