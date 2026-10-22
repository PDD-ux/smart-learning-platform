import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentAnswerSchema } from '@/lib/agent/contracts';
import { candidateClaimChoices, explanationForReview, reviewAnswer, type ReviewInput } from '@/lib/agent/faithfulness';

const modelFetch = vi.fn();
const input: ReviewInput = {
  candidate: agentAnswerSchema.parse({ answer: '材料甲可以处理多个任务。材料乙只能处理一个任务。建议回看原文并记录疑问。', sourceIds: [1], plan: { title: '回看原文与练习', steps: [{ title: '阅读原文再自行尝试作答', minutes: 10, pointNumbers: [] }] } }),
  sources: [{ sourceId: 1, excerpt: '材料甲只能处理一个任务；材料乙可以同时处理多个任务。' }], learning: { points: [{ score: null }] }, exercises: [],
};
const response = (value: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { status: 200 });
beforeEach((): void => {
  vi.stubEnv('LLM_PROVIDER', 'spark'); vi.stubEnv('AGENT_REVIEW_THINKING', 'false'); vi.stubEnv('SPARK_API_PASSWORD', 'test-only-key');
  modelFetch.mockReset(); vi.stubGlobal('fetch', modelFetch);
});
afterEach((): void => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('starts independent checks together and does not publish until both have passed', async (): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  let finishReview: (value: Response) => void = () => undefined;
  let finishTerms: (value: Response) => void = () => undefined;
  modelFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishReview = resolve; }));
  modelFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishTerms = resolve; }));
  let completed = false;
  const pending = reviewAnswer(input, {}).then((value) => { completed = true; return value; });
  expect(modelFetch).toHaveBeenCalledTimes(2);
  finishTerms(response({ unsupported: [] }));
  await Promise.resolve(); await Promise.resolve();
  expect(completed).toBe(false);
  finishReview(response(supportedCoverage()));
  expect((await pending).verdict).toBe('supported');
});

it('fails closed when terminology fails even if the main review supports the answer', async (): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockResolvedValueOnce(response(supportedCoverage())).mockRejectedValueOnce(new Error('upstream secret'));
  await expect(reviewAnswer(input, {})).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  expect(modelFetch).toHaveBeenCalledTimes(2);
});

it('maps both candidate and source numbers to actual text before returning review findings', async (): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockResolvedValueOnce(response({ verdict: 'contradicted', coverage: [{ claim: 1, verdict: 'contradicted' }, { claim: 2, verdict: 'contradicted' }, { claim: 3, verdict: 'supported' }, { claim: 4, verdict: 'supported' }, { claim: 5, verdict: 'supported' }], issues: [{ claim: 1, sourceQuote: 1, problem: '材料甲的单任务限制被改成多任务能力。' }] }));
  const review = await reviewAnswer(input, { timeoutMs: 20_000 });
  expect(review.issues[0]).toEqual({ claim: '材料甲可以处理多个任务。', sourceQuote: input.sources[0].excerpt, problem: '材料甲的单任务限制被改成多任务能力。' });
  const body = JSON.parse(String(modelFetch.mock.calls[0][1].body)) as { messages: Array<{ content: string }>; reasoning: { effort: string } };
  const actual = JSON.parse(body.messages[1].content) as { candidateClaimChoices: Array<{ claimNumber: number; excerpt: string }> };
  expect(actual.candidateClaimChoices).toContainEqual({ claimNumber: 5, excerpt: '阅读原文再自行尝试作答' });
  expect(body).not.toHaveProperty('reasoning');
});
it.each([0, 999, '1'])('rejects invented or stringified claim numbers %s after bounded format attempts', async (claim): Promise<void> => {
  modelFetch.mockImplementation(async (): Promise<Response> => response({ verdict: 'insufficient', issues: [{ claim, sourceQuote: '', problem: '无依据。' }] }));
  await expect(reviewAnswer(input, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  expect(modelFetch).toHaveBeenCalledTimes(2);
});
it('does not enable extended review on merely truthy or false configuration', async (): Promise<void> => {
  for (const [provider, ready] of [['spark', 'TRUE'], ['spark', 'false']]) {
    vi.stubEnv('LLM_PROVIDER', provider); vi.stubEnv('AGENT_REVIEW_THINKING', ready); vi.stubEnv('SPARK_API_PASSWORD', 'test-only-key');
    modelFetch.mockResolvedValueOnce(response({ verdict: 'supported', issues: [] }));
    await reviewAnswer(input, {});
    const body = JSON.parse(String(modelFetch.mock.calls.at(-1)?.[1].body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('thinking_budget');
    expect(body).not.toHaveProperty('reasoning');
  }
});
it('keeps claim choices continuous, bounded and faithful to English spaces across long candidates', (): void => {
  const candidate = agentAnswerSchema.parse({ answer: `the rapist cannot be rewritten. ${'材料甲可以处理一个任务。'.repeat(180)}`, sourceIds: [1] });
  const choices = candidateClaimChoices(candidate);
  expect(choices[0].excerpt).toBe('the rapist cannot be rewritten.');
  expect(choices.length).toBeLessThanOrEqual(60);
  expect(choices.every((choice) => candidate.answer.replace(/\s+/gu, ' ').trim().includes(choice.excerpt) && choice.excerpt.length <= 300)).toBe(true);
});
it('removes only matching server-added quote prefixes and still reviews the complete explanation and plan', async (): Promise<void> => {
  const answer = `原文：“${input.sources[0].excerpt}”\n${input.candidate.answer}`;
  modelFetch.mockResolvedValueOnce(response({ verdict: 'contradicted', issues: [{ claim: 1, sourceQuote: 1, problem: '主体能力交换。' }] }));
  const review = await reviewAnswer({ ...input, candidate: { ...input.candidate, answer } }, {});
  const body = JSON.parse(String(modelFetch.mock.calls[0][1].body)) as { messages: Array<{ content: string }> };
  const actual = JSON.parse(body.messages[1].content) as ReviewInput;
  expect(actual.candidate.answer).toBe(input.candidate.answer);
  expect(actual.candidate.plan).toEqual(input.candidate.plan);
  expect(actual.sources).toEqual(input.sources);
  expect(review.issues[0].claim).toBe('材料甲可以处理多个任务。');
  expect(answer).toContain(review.issues[0].claim);
});
it('never hides a fabricated prefix, quoted explanation, or meaningful English-space change', (): void => {
  for (const answer of ['原文：“材料甲可以处理多个任务”\n后文解释。', '解释：“材料甲只能处理一个任务”。', '原文：“the rapist is here”\n后文解释。']) {
    expect(explanationForReview(answer, [...input.sources, { sourceId: 2, excerpt: 'therapist is here' }])).toBe(answer);
  }
});
it('fails before model calls if the candidate exceeds complete per-claim review capacity', async (): Promise<void> => {
  const candidate = agentAnswerSchema.parse({ answer: Array.from({ length: 61 }, (_value, index) => `材料${index}只能处理一个任务。`).join(''), sourceIds: [1] });
  await expect(reviewAnswer({ ...input, candidate }, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  expect(modelFetch).not.toHaveBeenCalled();
});
it.each([
  undefined,
  [{ claim: 1, verdict: 'supported' }, { claim: 1, verdict: 'supported' }, { claim: 3, verdict: 'supported' }, { claim: 4, verdict: 'supported' }, { claim: 5, verdict: 'supported' }],
  [{ claim: 1, verdict: 'insufficient' }, { claim: 2, verdict: 'supported' }, { claim: 3, verdict: 'supported' }, { claim: 4, verdict: 'supported' }, { claim: 5, verdict: 'supported' }],
])('rejects missing, duplicate or contradictory per-claim coverage', async (coverage): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockImplementation(async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    return response(body.messages[0].content.includes('课程术语核对员') ? { unsupported: [] } : { verdict: 'supported', coverage, issues: [] });
  });
  await expect(reviewAnswer(input, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  expect(modelFetch).toHaveBeenCalledTimes(3); // Two format attempts plus one independent term check.
});

const supportedCoverage = (): unknown => ({ verdict: 'supported', coverage: candidateClaimChoices(input.candidate).map((item) => ({ claim: item.claimNumber, verdict: 'supported' })), issues: [] });
it.each([['', 'insufficient'], [1, 'contradicted']] as const)('maps a thinking rejection with source %s conservatively to %s without inventing evidence', async (sourceQuote, verdict): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockResolvedValueOnce(response({ verdict: 'rejected', coverage: candidateClaimChoices(input.candidate).map((item) => ({ claim: item.claimNumber, verdict: item.claimNumber === 1 ? 'rejected' : 'supported' })), issues: [{ claim: 1, sourceQuote, problem: '候选能力与来源不一致。' }] })).mockResolvedValueOnce(response({ unsupported: [] }));
  expect(await reviewAnswer(input, {})).toMatchObject({ verdict, issues: [{ claim: '材料甲可以处理多个任务。', sourceQuote: sourceQuote ? input.sources[0].excerpt : '' }] });
  expect(modelFetch).toHaveBeenCalledTimes(2);
});
it('does not accept an empty rejection or add the thinking negative protocol to the default reviewer', async (): Promise<void> => {
  for (const thinking of ['true', 'false']) {
    vi.stubEnv('AGENT_REVIEW_THINKING', thinking); modelFetch.mockClear();
    modelFetch.mockImplementation(async (_url: string, init: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      return response(body.messages[0].content.includes('课程术语核对员') ? { unsupported: [] } : { verdict: 'rejected', coverage: candidateClaimChoices(input.candidate).map((item) => ({ claim: item.claimNumber, verdict: 'rejected' })), issues: [] });
    });
    await expect(reviewAnswer(input, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(modelFetch).toHaveBeenCalledTimes(thinking === 'true' ? 3 : 2);
  }
});
it('independently rejects an actual added term even after the first reviewer accepts the overall explanation', async (): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockResolvedValueOnce(response(supportedCoverage())).mockResolvedValueOnce(response({ unsupported: [{ claim: 1, term: '材料甲' }] }));
  const actualInput = { ...input, sources: [{ sourceId: 1, excerpt: '这里描述的是任务处理能力。' }] };
  expect(await reviewAnswer(actualInput, { deadlineAt: Date.now() + 90_000 })).toMatchObject({ verdict: 'insufficient', issues: [{ claim: input.candidate.answer.split('。')[0] + '。', sourceQuote: '', problem: expect.stringContaining('材料甲') }] });
  expect(modelFetch).toHaveBeenCalledTimes(2);
  const body = JSON.parse(String(modelFetch.mock.calls[1][1].body)) as { messages: Array<{ content: string }> };
  expect(JSON.parse(body.messages[1].content)).toMatchObject({ sources: actualInput.sources });
});
it('keeps a supported explanation when the separate terminology check finds no additions', async (): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockResolvedValueOnce(response(supportedCoverage())).mockResolvedValueOnce(response({ unsupported: [] }));
  expect(await reviewAnswer(input, {})).toEqual({ verdict: 'supported', issues: [] });
  expect(modelFetch).toHaveBeenCalledTimes(2);
});
it.each([{ claim: 999, term: '材料甲' }, { claim: 1, term: '不存在的术语' }, { claim: 1, term: '材料甲' }])('rejects invalid terminology findings rather than reporting invented evidence', async (finding): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  modelFetch.mockResolvedValueOnce(response(supportedCoverage())).mockImplementation(async (): Promise<Response> => response({ unsupported: [finding] }));
  await expect(reviewAnswer(input, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  expect(modelFetch).toHaveBeenCalledTimes(3);
});
it('does not launch either independent audit after the absolute deadline is exhausted', async (): Promise<void> => {
  vi.stubEnv('AGENT_REVIEW_THINKING', 'true');
  const deadlineAt = Date.now() + 90_000;
  const now = vi.spyOn(Date, 'now').mockReturnValue(deadlineAt + 1);
  modelFetch.mockResolvedValueOnce(response(supportedCoverage()));
  try {
    await expect(reviewAnswer(input, { deadlineAt })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(modelFetch).not.toHaveBeenCalled();
  } finally { now.mockRestore(); }
});
