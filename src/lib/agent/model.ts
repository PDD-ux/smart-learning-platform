import type { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AiError, modelProvider, extractJson, type ChatMessage, type ChatOptions, type ChatResult } from '@/lib/ai/spark';
import { taskLogger } from '@/lib/jobs/task-logger';

export type AgentModelDiagnostic = {
  stage: NonNullable<ChatOptions['agentStage']> | 'unspecified';
  durationMs: number;
  startedAtMs: number;
  outcome: 'success' | 'failure';
  code?: string;
  attempts?: number;
  promptTokens?: number;
  completionTokens?: number;
};
const diagnostics = new AsyncLocalStorage<AgentModelDiagnostic[]>();

export function withAgentDiagnostics<T>(events: AgentModelDiagnostic[], action: () => Promise<T>): Promise<T> {
  return diagnostics.run(events, action);
}

/** Agent shares the same server-only provider choice as every other text workload. */
export function agentModelProvider(): NonNullable<ChatOptions['provider']> {
  return modelProvider();
}

export async function extractAgentJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: ChatOptions = {},
): Promise<{ data: T; usage?: ChatResult['usage']; attempts: number }> {
  const startedAt = Date.now();
  const event: AgentModelDiagnostic = { stage: options.agentStage ?? 'unspecified', startedAtMs: startedAt, durationMs: 0, outcome: 'failure' };
  try {
    const result = await extractJson(messages, schema, { ...options, provider: agentModelProvider() });
    event.outcome = 'success'; event.attempts = result.attempts;
    event.promptTokens = result.usage?.prompt_tokens; event.completionTokens = result.usage?.completion_tokens;
    return result;
  } catch (reason: unknown) {
    event.code = reason instanceof AiError ? reason.code : 'INTERNAL_ERROR';
    throw reason;
  } finally {
    event.durationMs = Date.now() - startedAt;
    diagnostics.getStore()?.push(event);
    // Observability cannot change model success/failure; never log messages or response bodies.
    try { taskLogger.info('agent: model stage completed', { ...event, traceId: options.traceId }); } catch { /* logger unavailable */ }
  }
}
