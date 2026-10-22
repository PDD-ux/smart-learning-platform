import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { extractAgentJson, withAgentDiagnostics, type AgentModelDiagnostic } from '@/lib/agent/model';
import { taskLogger } from '@/lib/jobs/task-logger';

const modelFetch = vi.fn();
const schema = z.object({ value: z.string() });
const messages = [{ role: 'user' as const, content: 'private-material-secret' }];
beforeEach((): void => {
  vi.stubEnv('AGENT_MODEL_PROVIDER', 'spark'); vi.stubEnv('LLM_PROVIDER', 'spark'); vi.stubEnv('SPARK_API_PASSWORD', 'private-key-secret');
  vi.stubGlobal('fetch', modelFetch); modelFetch.mockReset();
  vi.spyOn(taskLogger, 'info').mockImplementation((): void => undefined);
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('isolates concurrent traces and keeps credentials and model bodies out of diagnostics', async (): Promise<void> => {
  let resolveFirst: (value: Response) => void = () => undefined;
  modelFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }));
  modelFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":"private-output-secret"}' } }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } })));
  const first: AgentModelDiagnostic[] = []; const second: AgentModelDiagnostic[] = [];
  const pending = withAgentDiagnostics(first, () => extractAgentJson(messages, schema, { agentStage: 'decision' }));
  await withAgentDiagnostics(second, () => extractAgentJson(messages, schema, { agentStage: 'answer' }));
  expect(first).toEqual([]); expect(second).toHaveLength(1); expect(second[0]).toMatchObject({ stage: 'answer', outcome: 'success', attempts: 1, promptTokens: 12, completionTokens: 5 });
  resolveFirst(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":"private-first-secret"}' } }] })));
  await pending;
  expect(first).toHaveLength(1); expect(first[0].stage).toBe('decision');
  expect(JSON.stringify([first, second, vi.mocked(taskLogger.info).mock.calls])).not.toContain('secret');
  expect(String(modelFetch.mock.calls[0][1].body)).not.toContain('agentStage');
});

it('does not change a successful model result if logging fails', async (): Promise<void> => {
  vi.mocked(taskLogger.info).mockImplementation((): never => { throw new Error('logger failure'); });
  modelFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":"ready"}' } }] })));
  expect((await extractAgentJson(messages, schema)).data.value).toBe('ready');
});

it('records a safe failure code without exposing error or prompt text', async (): Promise<void> => {
  const events: AgentModelDiagnostic[] = [];
  modelFetch.mockRejectedValueOnce(new Error('private-network-secret'));
  await expect(withAgentDiagnostics(events, () => extractAgentJson(messages, schema, { agentStage: 'review' }))).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  expect(events[0]).toMatchObject({ stage: 'review', outcome: 'failure', code: 'UPSTREAM_ERROR' });
  expect(events[0]).not.toHaveProperty('attempts'); expect(JSON.stringify(events)).not.toContain('secret');
});

it('classifies truncated Agent output without retrying the same output budget', async (): Promise<void> => {
  const events: AgentModelDiagnostic[] = [];
  modelFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":"unfinished' }, finish_reason: 'length' }] })));
  await expect(withAgentDiagnostics(events, () => extractAgentJson(messages, schema, { agentStage: 'answer' }))).rejects.toMatchObject({ code: 'OUTPUT_TRUNCATED' });
  expect(modelFetch).toHaveBeenCalledTimes(1);
  expect(events[0]).toMatchObject({ stage: 'answer', outcome: 'failure', code: 'OUTPUT_TRUNCATED' });
});
