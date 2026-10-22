import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, extractJson } from '@/lib/ai/spark';
import { z } from 'zod';

describe('safe Spark business errors', () => {
  const fetchMock = vi.fn();
  beforeEach((): void => { vi.stubEnv('LLM_PROVIDER', 'spark'); vi.stubEnv('SPARK_API_PASSWORD', 'isolated-test-credential'); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach((): void => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each([500, 200])('surfaces input review failure at HTTP %s without exposing raw errors or retrying', async (status): Promise<void> => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: '10013', message: 'isolated-test-credential private source' } }), { status }));
    await expect(extractJson([{ role: 'user', content: 'classroom source' }], z.object({ title: z.string() }))).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502, message: expect.stringContaining('输入内容审核未通过') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [10014, '输出内容审核未通过'], [10019, '内容审核未通过'], [10907, '输入长度超过限制'],
    [10007, '请求流量受限'], [11200, '授权或业务量受限'], [11201, '当日调用量达到限制'],
    [11202, '秒级请求频率超过限制'], [11203, '并发请求数超过限制'],
  ])('maps top-level business code %s to a fixed cause', async (code, cause): Promise<void> => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code, message: 'untrusted secret', choices: [{ message: { content: 'must not accept' } }] }), { status: 200 }));
    await expect(chat([{ role: 'user', content: 'source' }])).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining(cause) });
  });

  it.each([{ error: { code: 99999, message: 'isolated-test-credential' } }, { error: { code: 'isolated-test-credential' } }, { error: { code: null, message: 'private source' } }])('uses generic error for unrecognized upstream fields: %j', async (body): Promise<void> => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 500 }));
    await expect(chat([{ role: 'user', content: 'source' }])).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: '星火模型调用失败（HTTP 500）' });
  });

  it('keeps a non-JSON error generic', async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(new Response('<html>isolated-test-credential</html>', { status: 500 }));
    await expect(chat([{ role: 'user', content: 'source' }])).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: '星火模型调用失败（HTTP 500）' });
  });

  it('rejects unknown HTTP200 business errors even with an answer', async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 99999, choices: [{ message: { content: 'not accepted' } }] }), { status: 200 }));
    await expect(chat([{ role: 'user', content: 'source' }])).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('accepts code zero and preserves valid success content', async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, choices: [{ message: { content: '正常回答' } }] }), { status: 200 }));
    await expect(chat([{ role: 'user', content: 'source' }])).resolves.toMatchObject({ content: '正常回答' });
  });
  it('sends the documented Spark JSON format without mutating caller messages or retrying silently', async (): Promise<void> => {
    const messages = [{ role: 'user' as const, content: '只依据自编资料返回指定对象' }], before = JSON.stringify(messages);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }));
    await chat(messages, { provider: 'spark', jsonMode: true, maxTokens: 700 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('spark-api-open.xf-yun.com');
    const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    expect(body).toMatchObject({ response_format: { type: 'json_object' }, max_tokens: 700 }); expect(body.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('JSON') }); expect(body.messages.at(-1)).toEqual(messages[0]); expect(JSON.stringify(messages)).toBe(before); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps ordinary Spark text requests unchanged', async (): Promise<void> => {
    const messages = [{ role: 'system' as const, content: '解释自编定义' }, { role: 'user' as const, content: '什么是偶数' }];
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, choices: [{ message: { content: '解释' } }] }), { status: 200 })); await chat(messages, { provider: 'spark' });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { messages: unknown; response_format?: unknown }; expect(body.messages).toEqual(messages); expect(body.response_format).toBeUndefined();
  });
});
