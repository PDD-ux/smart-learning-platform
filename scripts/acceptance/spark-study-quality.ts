import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { AiError, extractJson, modelProvider } from '../../src/lib/ai/spark';
import { reviewAnswer } from '../../src/lib/agent/faithfulness';

/** Two original synthetic checks only. No database, private course, fallback or automatic readiness change. */
async function main(): Promise<void> {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error('usage');
  const location = relative(resolve('.taskbook-working'), resolve(output));
  if (!location || isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) throw new Error('output');
  await mkdir(output, { recursive: false });
  loadEnvConfig(process.cwd(), true);
  if (modelProvider() !== 'spark') throw new Error('provider');
  // Probe the basic guard only; do not inherit an experimental extra-review setting.
  process.env.AGENT_REVIEW_THINKING = 'false';
  const source = '设备甲每次只能处理一个任务。设备乙可以同时处理多个任务。本课不讨论处理速度或使用成本。';
  const results: Record<string, unknown>[] = [];
  const started = Date.now();
  try {
    const result = await extractJson([
      { role: 'system', content: '你是学习资料整理员。仅使用S1，不补充常识、速度或成本结论。只输出JSON对象：capacities为{jia:"single|multiple",yi:"single|multiple"}，表示原文设备甲/乙的并行任务数量；points为2项{sourceId:"S1",summary:"简洁概括",quote:"S1中连续原文"}。' },
      { role: 'user', content: JSON.stringify({ S1: source }) },
    ], z.object({ capacities: z.object({ jia: z.enum(['single', 'multiple']), yi: z.enum(['single', 'multiple']) }), points: z.array(z.object({ sourceId: z.literal('S1'), summary: z.string().min(1).max(200), quote: z.string().min(6).max(180) })).length(2) }), { maxTokens: 600, temperature: 0, timeoutMs: 30000, deadlineAt: started + 30000 });
    const passed = result.data.capacities.jia === 'single' && result.data.capacities.yi === 'multiple' && result.data.points.every((point): boolean => source.includes(point.quote));
    results.push({ check: 'source-notes', passed, data: result.data, attempts: result.attempts, usage: result.usage, elapsedMs: Date.now() - started });
  } catch (error: unknown) {
    results.push({ check: 'source-notes', passed: false, code: error instanceof AiError ? error.code : 'INTERNAL_ERROR', elapsedMs: Date.now() - started });
  }
  const reviewStarted = Date.now();
  try {
    const result = await reviewAnswer({ candidate: { answer: '设备甲可以同时处理多个任务，设备乙每次只能处理一个任务。', sourceIds: [1], exerciseNumbers: [], plan: null }, sources: [{ sourceId: 1, excerpt: source }], learning: {}, exercises: [] }, { maxTokens: 900, timeoutMs: 30000, deadlineAt: reviewStarted + 30000 });
    results.push({ check: 'swapped-subject-rejection', passed: result.verdict === 'contradicted', data: result, elapsedMs: Date.now() - reviewStarted });
  } catch (error: unknown) {
    results.push({ check: 'swapped-subject-rejection', passed: false, code: error instanceof AiError ? error.code : 'INTERNAL_ERROR', elapsedMs: Date.now() - reviewStarted });
  }
  const report = { checkedAt: new Date().toISOString(), provider: 'spark', model: process.env.SPARK_MODEL || 'lite', source, results, passed: results.every((item): boolean => item.passed === true), scope: 'Two synthetic short checks, not full teaching-quality acceptance', readinessChanged: false, databaseWrites: false, maxFormatAttemptsPerCheck: 2 };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ provider: report.provider, model: report.model, passed: report.passed, results: results.map(({ check, passed, code, elapsedMs }) => ({ check, passed, code, elapsedMs })) }) + '\n');
  if (!report.passed) process.exitCode = 1;
}
void main().catch((): void => { process.stderr.write('检查未完成：需指定.taskbook-working下不存在的新目录；未输出私有异常。\n'); process.exitCode = 1; });
