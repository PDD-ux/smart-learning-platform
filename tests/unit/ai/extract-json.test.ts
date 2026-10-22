import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { extractJson } from '@/lib/ai/spark';

const schema = z.object({ value: z.string().min(1), count: z.number().int().nonnegative() });

function response(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('extractJson', () => {
  const originalApiPassword = process.env.SPARK_API_PASSWORD;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('LLM_PROVIDER', 'spark'); process.env.SPARK_API_PASSWORD = 'test-password';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    if (originalApiPassword === undefined) delete process.env.SPARK_API_PASSWORD;
    else process.env.SPARK_API_PASSWORD = originalApiPassword;
  });

  it('strips a JSON code fence and validates the first response', async () => {
    fetchMock.mockResolvedValueOnce(response('```json\n{"value":"ready","count":2}\n```'));

    const result = await extractJson([{ role: 'user', content: 'return JSON' }], schema);

    expect(result).toMatchObject({ data: { value: 'ready', count: 2 }, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards traceId to the model gateway', async () => {
    fetchMock.mockResolvedValueOnce(response('{"value":"ready","count":2}'));

    await extractJson([{ role: 'user', content: 'return JSON' }], schema, { traceId: 'trace-llm-1' });

    expect(fetchMock.mock.calls[0]?.[1]?.headers['X-Trace-Id']).toBe('trace-llm-1');
  });

  it('retries with a correction message after schema validation fails', async () => {
    fetchMock
      .mockResolvedValueOnce(response('{"value":"missing count"}'))
      .mockResolvedValueOnce(response('{"value":"fixed","count":3}'));

    const result = await extractJson([{ role: 'user', content: 'return JSON' }], schema);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as { messages: Array<{ content: string }> };

    expect(result).toMatchObject({ data: { value: 'fixed', count: 3 }, attempts: 2 });
    expect(retryBody.messages.at(-1)?.content).toContain('请严格重新输出符合要求的 JSON');
    expect(retryBody.messages.at(-2)?.content).toContain('missing count');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a schema error after two invalid responses', async () => {
    fetchMock
      .mockResolvedValueOnce(response('not-json'))
      .mockResolvedValueOnce(response('{"value":"still missing count"}'));

    const promise = extractJson([{ role: 'user', content: 'return JSON' }], schema);

    await expect(promise).rejects.toMatchObject({ code: 'SCHEMA_INVALID', status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
