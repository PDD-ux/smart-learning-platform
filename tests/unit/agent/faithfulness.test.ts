import { expect, it } from 'vitest';
import { quoteIssues, reviewSchema } from '@/lib/agent/faithfulness';

it('requires literal quotations from the selected evidence rather than paraphrases or invented assertions', () => {
  const sources = [{ sourceId: 2, excerpt: '材料甲可以处理多个任务。\n材料乙一次只能处理一个任务。' }];
  expect(quoteIssues('原文：“材料乙一次只能处理一个任务”。', sources)).toEqual([]);
  expect(quoteIssues('材料乙处理能力较弱。', sources)).not.toEqual([]);
  expect(quoteIssues('原文：“材料乙可以处理多个任务”。', sources)).not.toEqual([]);
  expect(quoteIssues('“材料乙一次只能处理一个任务”，还说“甲支持所有任务”。', sources)).not.toEqual([]);
});
it('does not join disjoint text or remove meaningful English spaces', () => {
  expect(quoteIssues('“first second”', [{ sourceId: 1, excerpt: 'first\n second' }])).toEqual([]);
  expect(quoteIssues('“the rapist”', [{ sourceId: 1, excerpt: 'therapist' }])).not.toEqual([]);
  expect(quoteIssues('“甲只能处理一个任务”', [{ sourceId: 1, excerpt: '甲只能。某个其它段落。处理一个任务' }])).not.toEqual([]);
});
it('also checks short quoted terms instead of allowing unsupported wording under six characters', (): void => {
  const sources = [{ sourceId: 1, excerpt: '材料甲需要集合力量协同处理。' }];
  expect(quoteIssues('“材料甲需要集合力量协同处理”。这里强调“集合力量”。', sources)).toEqual([]);
  expect(quoteIssues('“材料甲需要集合力量协同处理”。这就是“未知术语”。', sources)).not.toEqual([]);
  expect(quoteIssues('只看“集合力量”。', sources)).not.toEqual([]);
  expect(quoteIssues('当前状态“未知”。', [])).not.toEqual([]);
});
it('rejects quotes from unselected sources and permits status-only answers without sources', () => {
  expect(quoteIssues('“材料乙一次只能处理一个任务”', [{ sourceId: 1, excerpt: '材料甲可以处理多个任务' }])).not.toEqual([]);
  expect(quoteIssues('暂无掌握记录，建议先练习。', [])).toEqual([]);
  expect(quoteIssues('原文：“凭空生成的资料内容”', [])).not.toEqual([]);
});
it('bounds quotations and rejects contradictory review verdicts rather than silently accepting them', () => {
  expect(quoteIssues(`“${'甲'.repeat(181)}”`, [{ sourceId: 1, excerpt: '甲'.repeat(200) }])).not.toEqual([]);
  expect(quoteIssues('“材料乙一次只能处理一个任务”'.repeat(6), [{ sourceId: 1, excerpt: '材料乙一次只能处理一个任务' }])).not.toEqual([]);
  for (const value of [{ verdict: 'supported', issues: ['矛盾'] }, { verdict: 'contradicted', issues: [] }, { verdict: 'insufficient', issues: [] }, { verdict: 'supported', issues: [], ownerId: 'other' }]) {
    const result = reviewSchema.safeParse(value);
    expect(result.success).toBe(value.verdict === 'supported' && !value.issues.length);
    if (result.success) expect(result.data).not.toHaveProperty('ownerId');
  }
});
