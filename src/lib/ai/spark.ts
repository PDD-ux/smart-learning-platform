import { z } from 'zod';
import { schemaDiagnostic, type SchemaDiagnostic } from './schema-diagnostics';

import { recordCounter, recordLatency } from '@/lib/observability/metrics';
import { AI_DEFAULTS } from '@/lib/config';

/**
 * Unified server-side LLM gateway (legacy filename retained for callers).
 * Spark is the sole text provider; credentials never select a different model or service.
 */

function defaultTimeoutMs(): number {
  const value = Number(process.env.SPARK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ModelProvider = 'spark';

/** One server-side choice for every workload. Credentials never choose a fallback. */
export function modelProvider(): ModelProvider {
  const provider = process.env.LLM_PROVIDER?.trim() || 'spark';
  if (provider !== 'spark') throw new AiError('LLM_PROVIDER仅支持spark', 'MODEL_CONFIG_INVALID', 500);
  return provider;
}

export type ChatOptions = {
  provider?: ModelProvider;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  traceId?: string;
  deadlineAt?: number;
  agentStage?: 'decision' | 'answer' | 'review' | 'terms';
  signal?: AbortSignal;
};

type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatResult = {
  content: string;
  usage?: TokenUsage;
};

export class AiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 500,
    public diagnostic?: SchemaDiagnostic,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Structured-output providers require an explicit JSON instruction as well as the format parameter. */
function withJsonInstruction(messages: ChatMessage[]): ChatMessage[] {
  const instruction = '请严格按 JSON 格式输出一个对象，不添加代码围栏或其它文本。';
  if (messages[0]?.role === 'system') return [{ ...messages[0], content: `${messages[0].content}\n${instruction}` }, ...messages.slice(1)];
  return [{ role: 'system', content: instruction }, ...messages];
}

const SPARK_ERROR_CAUSES: Readonly<Record<string, string>> = {
  '10007': '请求流量受限，请等待当前请求结束后再试',
  '10013': '输入内容审核未通过，请核对资料内容或联系服务商',
  '10014': '输出内容审核未通过，当前结果无法使用',
  '10019': '内容审核未通过，请核对资料内容或联系服务商',
  '10907': '输入长度超过限制，请缩小资料范围',
  '11200': '授权或业务量受限，请在讯飞控制台核对权限和用量',
  '11201': '当日调用量达到限制，请在讯飞控制台核对日限额',
  '11202': '秒级请求频率超过限制，请稍后手动重试',
  '11203': '并发请求数超过限制，请等待其它请求结束',
};

/** Only fixed messages and whitelisted numeric codes may cross the gateway. */
function sparkFailure(body: unknown, status: number, httpFailure: boolean): AiError | null {
  const envelope = z.object({ code: z.unknown().optional(), error: z.unknown().optional() }).safeParse(body);
  const nested = envelope.success ? z.object({ code: z.unknown().optional() }).safeParse(envelope.data.error) : null;
  const raw = nested?.success ? nested.data.code ?? (envelope.success ? envelope.data.code : undefined)
    : envelope.success ? envelope.data.code : undefined;
  const code = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw)
    : typeof raw === 'string' && /^\d{1,8}$/.test(raw) ? String(Number(raw)) : undefined;
  const businessFailure = envelope.success && (envelope.data.error != null
    || (envelope.data.code !== undefined && envelope.data.code !== 0 && envelope.data.code !== '0'));
  if (!httpFailure && !businessFailure) return null;
  const cause = code ? SPARK_ERROR_CAUSES[code] : undefined;
  return new AiError(cause ? `星火模型调用失败（${code}：${cause}）`
    : `星火模型调用失败（HTTP ${status}${httpFailure ? '' : '，业务错误'}）`, 'UPSTREAM_ERROR', 502);
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const provider = opts.provider ?? modelProvider();
  if (provider !== 'spark') throw new AiError('模型供应商配置非法', 'MODEL_CONFIG_INVALID', 500);
  const label = '星火';
  const startedAt = Date.now();
  let outcome = 'failure';
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  opts.signal?.addEventListener('abort', cancel, { once: true });
  if (opts.signal?.aborted) cancel();
  const remaining = opts.deadlineAt === undefined ? Infinity : opts.deadlineAt - startedAt;
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, remaining)));
  const checkDeadline = (): void => {
    if (opts.deadlineAt !== undefined && !Number.isFinite(opts.deadlineAt)) throw new AiError('模型请求期限无效', 'MODEL_CONFIG_INVALID', 500);
    if (opts.signal?.aborted) throw new AiError(`${label}模型调用已取消`, 'CANCELLED', 499);
    if (controller.signal.aborted) throw new AiError(`${label}模型调用超时，请稍后重试`, 'TIMEOUT', 504);
    if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) throw new AiError(`${label}模型调用超过总时限`, 'TIMEOUT', 504);
  };

  try {
    checkDeadline();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AiError('模型超时配置非法', 'MODEL_CONFIG_INVALID', 500);
    const keyName = 'SPARK_API_PASSWORD';
    const apiPassword = process.env[keyName]?.trim();
    if (!apiPassword) {
      throw new AiError(`未配置 ${keyName}，请在 .env.local 中填写后重启服务`, 'MISSING_API_KEY', 500);
    }
    if (!/^[\x21-\x7e]+$/u.test(apiPassword)) throw new AiError(`${keyName}格式无效，请填写服务商生成的真实API凭据`, 'MODEL_CONFIG_INVALID', 500);
    let endpoint: URL;
    try { endpoint = new URL(process.env.SPARK_BASE_URL?.trim() || 'https://spark-api-open.xf-yun.com/v1'); }
    catch { throw new AiError('模型API根地址无效', 'MODEL_CONFIG_INVALID', 500); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new AiError('模型地址必须为无凭据参数的HTTPS API根地址', 'MODEL_CONFIG_INVALID', 500);
    const maxTokens = opts.maxTokens ?? AI_DEFAULTS.MAX_TOKENS;
    const model = process.env.SPARK_MODEL?.trim() || 'lite';
    const limits: Readonly<Record<string, number>> = { lite: 4096, generalv3: 8192, 'generalv3.5': 8192, '4.0Ultra': 32768, 'max-32k': 32768, 'pro-128k': 32768 };
    const maximum = limits[model];
    if (!Object.hasOwn(limits, model)) throw new AiError('星火型号未支持，请核对SPARK_MODEL', 'MODEL_CONFIG_INVALID', 500);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > maximum) throw new AiError('模型输出预算超过当前星火型号范围', 'MODEL_CONFIG_INVALID', 500);
    const temperature = opts.temperature ?? AI_DEFAULTS.TEMPERATURE;
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new AiError('模型temperature配置非法', 'MODEL_CONFIG_INVALID', 500);
    const input = opts.jsonMode ? withJsonInstruction(messages) : messages;
    const body = {
      model, messages: input, stream: false, temperature, max_tokens: maxTokens,
      ...(model !== 'lite' ? { tools: [{ type: 'web_search', web_search: { enable: false } }] } : {}),
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
    const response = await fetch(`${endpoint.href.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiPassword}`,
        ...(opts.traceId ? { 'X-Trace-Id': opts.traceId } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });

    const json: unknown = await response.json().catch((error: unknown): null => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    checkDeadline();
    const failure = sparkFailure(json, response.status, !response.ok);
    if (failure) throw failure;
    const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.unknown().optional(), refusal: z.unknown().optional(), tool_calls: z.unknown().optional() }), finish_reason: z.string().nullable().optional() })) }).safeParse(json);
    if (!parsed.success) throw new AiError('星火模型返回格式异常', 'UPSTREAM_ERROR', 502);
    const choice = parsed.data.choices[0];
    if (choice?.finish_reason === 'length') throw new AiError('模型输出达到长度上限，请缩小范围后重试', 'OUTPUT_TRUNCATED', 502);
    if (choice?.finish_reason === 'content_filter' || choice?.message.refusal) throw new AiError('星火模型拒绝回答，请调整学习请求', 'MODEL_REFUSAL', 502);
    if (choice?.message.tool_calls != null || choice?.finish_reason != null && choice.finish_reason !== 'stop') throw new AiError('星火模型返回了未完成的文本回答', 'OUTPUT_INCOMPLETE', 502);
    if (typeof choice?.message.content !== 'string' || !choice.message.content.trim()) throw new AiError('星火模型返回内容为空', 'EMPTY_RESPONSE', 502);
    const usage = z.object({ usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }) }).safeParse(json);
    const result: ChatResult = { content: choice.message.content, ...(usage.success ? { usage: usage.data.usage } : {}) };
    checkDeadline();
    outcome = 'success';
    return result;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (opts.signal?.aborted) throw new AiError(`${label}模型调用已取消`, 'CANCELLED', 499);
    if (controller.signal.aborted || error instanceof Error && error.name === 'AbortError') {
      throw new AiError(`${label}模型调用超时，请稍后重试`, 'TIMEOUT', 504);
    }
    throw new AiError(`${label}模型调用异常`, 'UPSTREAM_ERROR', 502);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', cancel);
    recordCounter('slp_llm_requests_total', { provider, operation: 'chat', outcome });
    recordLatency('slp_llm_request_duration_seconds', Date.now() - startedAt, { provider, operation: 'chat', outcome });
  }
}

export async function extractJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts: ChatOptions = {},
): Promise<{ data: T; usage?: TokenUsage; attempts: number }> {
  let lastError = '';
  let diagnostic: SchemaDiagnostic | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { content, usage } = await chat(messages, { ...opts, jsonMode: true });
    try {
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();
      const parsed = schema.safeParse(JSON.parse(cleaned));
      if (parsed.success) return { data: parsed.data, usage, attempts: attempt };
      diagnostic = schemaDiagnostic(parsed.error.issues, attempt);
      lastError = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
        .slice(0, 300);
    } catch {
      lastError = 'JSON 解析失败：请只输出一个完整合法JSON对象';
      diagnostic = { kind: 'invalid_json', attempts: attempt, fields: [], issueCodes: [], rules: [] };
    }
    messages = [
      ...messages,
      { role: 'assistant', content: content.slice(0, 1_000) },
      { role: 'user', content: `上一轮输出不符合 JSON Schema 要求，错误为：${lastError}。请严格重新输出符合要求的 JSON。` },
    ];
  }

  throw new AiError(`模型输出两次均未通过校验：${lastError}`, 'SCHEMA_INVALID', 502, diagnostic);
}
