import { beforeEach, expect, it, vi } from 'vitest';
import type { z } from 'zod';
const m = vi.hoisted(() => ({ model: vi.fn(), reply: null as unknown }));
vi.mock('@/lib/agent/model', () => ({ extractAgentJson: m.model }));
import { reviewAnswer, type ReviewInput } from '@/lib/agent/faithfulness';
import type { ChatMessage } from '@/lib/ai/spark';

const input: ReviewInput = {
  candidate: { answer: '甲可以处理多个任务。', sourceIds: [1], exerciseNumbers: [], plan: null },
  sources: [{ sourceId: 1, excerpt: '甲只能处理一个任务。\n乙可以处理多个任务。' }], learning: {}, exercises: [],
};
beforeEach((): void => {
  vi.clearAllMocks();
  m.reply = { verdict: 'contradicted', issues: [{ claim: '甲可以处理多个任务', sourceQuote: 1, problem: '主体混淆' }] };
  m.model.mockImplementation(async (_messages: ChatMessage[], schema: z.ZodType<unknown, z.ZodTypeDef, unknown>): Promise<{ data: unknown }> => ({ data: schema.parse(m.reply) }));
});
it('restores a selected continuous server excerpt and preserves the original sources', async (): Promise<void> => {
  const before = JSON.stringify(input);
  const result = await reviewAnswer(input, {});
  expect(result.issues[0].sourceQuote).toBe('甲只能处理一个任务。 乙可以处理多个任务。');
  expect(JSON.stringify(input)).toBe(before);
  expect(m.model).toHaveBeenCalledTimes(1);
});
it.each([0, 2, 1.5, -1])('rejects invented or invalid quote numbers: %s', async (number): Promise<void> => {
  m.reply = { verdict: 'contradicted', issues: [{ claim: '甲可以处理多个任务', sourceQuote: number, problem: '主体混淆' }] };
  await expect(reviewAnswer(input, {})).rejects.toThrow();
});
it.each(['甲只能处理...乙可以处理多个任务', '甲可以处理多个任务'])('does not accept fabricated or joined strings: %s', async (quote): Promise<void> => {
  m.reply = { verdict: 'contradicted', issues: [{ claim: '甲可以处理多个任务', sourceQuote: quote, problem: '主体混淆' }] };
  await expect(reviewAnswer(input, {})).rejects.toThrow();
});
it('still rejects a nonexistent candidate claim even with a valid source number', async (): Promise<void> => {
  m.reply = { verdict: 'contradicted', issues: [{ claim: '不存在的候选内容', sourceQuote: 1, problem: '主体混淆' }] };
  await expect(reviewAnswer(input, {})).rejects.toThrow();
});
it('requires source evidence for contradicted and permits explicit insufficient evidence', async (): Promise<void> => {
  m.reply = { verdict: 'contradicted', issues: [{ claim: '甲可以处理多个任务', sourceQuote: '', problem: '没有依据' }] };
  await expect(reviewAnswer(input, {})).rejects.toThrow();
  m.reply = { verdict: 'insufficient', issues: [{ claim: '甲可以处理多个任务', sourceQuote: '', problem: '没有依据' }] };
  expect((await reviewAnswer(input, {})).verdict).toBe('insufficient');
});
it('bounds choices and keeps every excerpt a continuous substring of its source', async (): Promise<void> => {
  const sources = Array.from({ length: 5 }, (_, index) => ({ sourceId: index + 1, excerpt: '甲只能处理一个任务。乙可以处理多个任务。'.repeat(200) }));
  m.reply = { verdict: 'supported', issues: [] };
  await reviewAnswer({ ...input, sources }, {});
  const messages = m.model.mock.calls[0][0] as ChatMessage[];
  const payload = JSON.parse(messages.at(-1)?.content ?? '') as { sourceQuoteChoices: Array<{ quoteNumber: number; sourceId: number; excerpt: string }> };
  expect(payload.sourceQuoteChoices).toHaveLength(60);
  for (const [index, choice] of payload.sourceQuoteChoices.entries()) {
    expect(choice.quoteNumber).toBe(index + 1); expect(choice.excerpt.length).toBeLessThanOrEqual(160);
    expect(sources[choice.sourceId - 1].excerpt).toContain(choice.excerpt);
  }
});
