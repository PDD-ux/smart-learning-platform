import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { chat, extractJson, modelProvider } from '@/lib/ai/spark';
import { extractAgentJson } from '@/lib/agent/model';

const modelFetch = vi.fn();
const schema = z.object({ value: z.string() });
const messages = [{ role: 'user' as const, content: '只返回JSON对象' }];
function response(content: string, detail: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], ...detail }));
}
function body(): Record<string, unknown> { return JSON.parse(String(modelFetch.mock.calls[0][1].body)) as Record<string, unknown>; }
beforeEach((): void => {
  vi.stubEnv('LLM_PROVIDER', undefined); vi.stubEnv('SPARK_API_PASSWORD', 'spark-test-secret');
  vi.stubEnv('SPARK_MODEL', undefined); vi.stubEnv('SPARK_BASE_URL', undefined); vi.stubEnv('SPARK_TIMEOUT_MS', undefined);
  modelFetch.mockReset(); vi.stubGlobal('fetch', modelFetch);
});
afterEach((): void => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('defaults all workloads and Agent to Spark without another provider', async (): Promise<void> => {
  modelFetch.mockImplementation(async (): Promise<Response> => response('{"value":"ready"}'));
  expect(modelProvider()).toBe('spark');
  await extractJson(messages, schema, { maxTokens: 350, traceId: 'trace-test' });
  await extractAgentJson(messages, schema);
  expect(modelFetch.mock.calls.every((call): boolean => call[0] === 'https://spark-api-open.xf-yun.com/v1/chat/completions')).toBe(true);
  expect(body()).toMatchObject({ model: 'lite', stream: false, temperature: 0.3, max_tokens: 350, response_format: { type: 'json_object' } });
  for (const key of ['input', 'reasoning', 'store', 'max_output_tokens', 'agentStage', 'tools']) expect(body()).not.toHaveProperty(key);
  expect(modelFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer spark-test-secret', 'X-Trace-Id': 'trace-test' } });
  expect(String(modelFetch.mock.calls[0][1].body)).not.toContain('test-secret');
});
it.each([true, false])('adds JSON instruction without mutating caller messages (system=%s)', async (system): Promise<void> => {
  const input = [...(system ? [{ role: 'system' as const, content: '核对真实来源' }] : []), ...messages];
  const original = JSON.stringify(input); modelFetch.mockResolvedValueOnce(response('{"value":"ready"}'));
  await extractJson(input, schema);
  const wire = body().messages as Array<{ role: string; content: string }>;
  expect(wire[0].role).toBe('system'); expect(wire[0].content).toContain('JSON'); expect(JSON.stringify(input)).toBe(original);
});
it('preserves array/line workflows and maps usage without returning hidden reasoning', async (): Promise<void> => {
  modelFetch.mockResolvedValueOnce(response('[]', { usage: { prompt_tokens: 8, completion_tokens: 10, total_tokens: 18 }, reasoning_content: 'private-reasoning' }));
  expect(await chat(messages)).toEqual({ content: '[]', usage: { prompt_tokens: 8, completion_tokens: 10, total_tokens: 18 } });
  expect(body().messages).toEqual(messages); expect(body()).not.toHaveProperty('response_format');
});
it.each(['generalv3.5', 'generalv3', '4.0Ultra', 'max-32k', 'pro-128k'])('explicitly disables external search for %s', async (model): Promise<void> => {
  vi.stubEnv('SPARK_MODEL', model); modelFetch.mockResolvedValueOnce(response('ready')); await chat(messages);
  expect(body()).toMatchObject({ model, tools: [{ type: 'web_search', web_search: { enable: false } }] });
});
it.each(['openai', 'bigmodel', 'aliyun', 'unknown'])('rejects removed provider %s before networking', async (provider): Promise<void> => {
  vi.stubEnv('LLM_PROVIDER', provider); await expect(chat(messages)).rejects.toMatchObject({ code: 'MODEL_CONFIG_INVALID' }); expect(modelFetch).not.toHaveBeenCalled();
});
it('rejects missing credential without networking or fallback', async (): Promise<void> => {
  vi.stubEnv('SPARK_API_PASSWORD', ' '); await expect(chat(messages)).rejects.toMatchObject({ code: 'MISSING_API_KEY' }); expect(modelFetch).not.toHaveBeenCalled();
});
it.each(['中文占位', 'key with spaces', 'key\nline'])('rejects invalid credentials without echoing them', async (key): Promise<void> => {
  vi.stubEnv('SPARK_API_PASSWORD', key); await expect(chat(messages)).rejects.toMatchObject({ code: 'MODEL_CONFIG_INVALID' }); expect(modelFetch).not.toHaveBeenCalled();
});
it.each(['http://example.test/v1', 'https://user:secret@example.test/v1', 'https://example.test/v1?key=secret', 'invalid'])('rejects unsafe API root %s', async (url): Promise<void> => {
  vi.stubEnv('SPARK_BASE_URL', url); await expect(chat(messages)).rejects.toMatchObject({ code: 'MODEL_CONFIG_INVALID' }); expect(modelFetch).not.toHaveBeenCalled();
});
it.each([['lite', 4096], ['generalv3.5', 8192], ['4.0Ultra', 32768]] as const)('validates exact output boundary for %s', async (model, maximum): Promise<void> => {
  vi.stubEnv('SPARK_MODEL', model); modelFetch.mockResolvedValueOnce(response('ready')); await chat(messages, { maxTokens: maximum });
  expect(body().max_tokens).toBe(maximum); await expect(chat(messages, { maxTokens: maximum + 1 })).rejects.toMatchObject({ code: 'MODEL_CONFIG_INVALID' }); expect(modelFetch).toHaveBeenCalledTimes(1);
});
it.each([0, -1, 1.5, NaN])('rejects invalid output budget %s', async (maxTokens): Promise<void> => {
  await expect(chat(messages, { maxTokens })).rejects.toMatchObject({ code: 'MODEL_CONFIG_INVALID' }); expect(modelFetch).not.toHaveBeenCalled();
});
it('rejects prototype names and unconfigured model identifiers locally', async (): Promise<void> => {
  for (const model of ['toString', 'unknown']) { vi.stubEnv('SPARK_MODEL', model); await expect(chat(messages)).rejects.toMatchObject({ code: 'MODEL_CONFIG_INVALID' }); }
  expect(modelFetch).not.toHaveBeenCalled();
});
it('keeps at most one schema correction on the same endpoint', async (): Promise<void> => {
  modelFetch.mockResolvedValueOnce(response('bad-json')).mockResolvedValueOnce(response('{"value":"fixed"}'));
  expect((await extractJson(messages, schema)).attempts).toBe(2); expect(modelFetch).toHaveBeenCalledTimes(2);
});
it.each([['length', 'OUTPUT_TRUNCATED'], ['content_filter', 'MODEL_REFUSAL'], ['tool_calls', 'OUTPUT_INCOMPLETE']] as const)('rejects unfinished result %s without a format retry', async (finish_reason, code): Promise<void> => {
  modelFetch.mockResolvedValueOnce(response('{"value":"partial"}', { choices: [{ message: { content: '{"value":"partial"}' }, finish_reason }] }));
  await expect(extractJson(messages, schema)).rejects.toMatchObject({ code }); expect(modelFetch).toHaveBeenCalledTimes(1);
});
it('rejects unsolicited tool calls even if accompanied by valid text', async (): Promise<void> => {
  modelFetch.mockResolvedValueOnce(response('ready', { choices: [{ message: { content: 'ready', tool_calls: [] }, finish_reason: 'stop' }] }));
  await expect(chat(messages)).rejects.toMatchObject({ code: 'OUTPUT_INCOMPLETE' });
});
it('honors cancellation and expired deadline without networking', async (): Promise<void> => {
  const controller = new AbortController(); controller.abort();
  await expect(chat(messages, { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  await expect(chat(messages, { deadlineAt: Date.now() - 1 })).rejects.toMatchObject({ code: 'TIMEOUT' }); expect(modelFetch).not.toHaveBeenCalled();
});
it('aborts an in-flight request without a format retry', async (): Promise<void> => {
  vi.useFakeTimers(); modelFetch.mockImplementation((_url: unknown, init: RequestInit): Promise<Response> => new Promise((_resolve, reject): void => { init.signal?.addEventListener('abort', (): void => reject(new DOMException('Aborted', 'AbortError')), { once: true }); }));
  const pending = expect(extractJson(messages, schema, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(21); await pending; expect(modelFetch).toHaveBeenCalledTimes(1);
});
