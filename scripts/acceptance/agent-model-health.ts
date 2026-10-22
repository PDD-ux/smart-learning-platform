import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AiError, extractJson, type ModelProvider } from '../../src/lib/ai/spark';
import { z } from 'zod';

/** One original, nonprivate probe per selected provider, with at most two format attempts; no fallback. */
async function probe(provider: ModelProvider): Promise<Record<string, unknown>> {
  const start = Date.now();
  const base = { provider, verifiedAt: new Date().toISOString(), model: process.env.SPARK_MODEL || 'lite' };
  try {
    // chat rather than extractJson would not check structured output; cap all requests with a shared deadline.
    const result = await extractJson([{ role: 'user', content: '这是一项接口核验。请只输出JSON对象：{"value":"ready"}。' }], z.object({ value: z.literal('ready') }), { provider, maxTokens: 100, timeoutMs: 30000, deadlineAt: start + 30000 });
    return { ...base, outcome: 'available', attempts: result.attempts, usage: result.usage, elapsedMs: Date.now() - start };
  } catch (error: unknown) {
    return { ...base, outcome: 'blocked', code: error instanceof AiError ? error.code : 'INTERNAL_ERROR', status: error instanceof AiError ? error.status : 500, elapsedMs: Date.now() - start };
  }
}
async function main(): Promise<void> {
  const [selection, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length || selection !== 'spark') throw new Error('usage');
  const outputPath = resolve(output), location = relative(resolve('.taskbook-working'), outputPath);
  if (!location || isAbsolute(location) || location === '..' || location.startsWith(`..${sep}`)) throw new Error('output');
  await mkdir(outputPath, { recursive: false }); // Never overwrite previous evidence or load credentials first.
  loadEnvConfig(process.cwd(), true);
  const providers: ModelProvider[] = ['spark'];
  const results: Record<string, unknown>[] = [];
  for (const provider of providers) {
    const result = await probe(provider); results.push(result);
    await writeFile(resolve(outputPath, `${provider}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
    process.stdout.write(JSON.stringify(result) + '\n');
  }
  await writeFile(resolve(outputPath, 'report.json'), JSON.stringify({ results, allAvailable: results.every((result): boolean => result.outcome === 'available'), semanticAcceptance: false, maxFormatAttemptsPerProvider: 2, automaticProviderFallback: false }, null, 2), { flag: 'wx' });
  if (results.some((result): boolean => result.outcome !== 'available')) process.exitCode = 1;
}
void main().catch((): void => {
  process.stderr.write('诊断未完成：用法 npx tsx scripts/acceptance/agent-model-health.ts <spark> <.taskbook-working下的新目录>；不覆盖已有证据，不输出私有异常。\n');
  process.exitCode = 1;
});
