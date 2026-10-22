/** Exactly one Spark request per frozen heldout prompt. No retries, repair or fallback. */
import { loadEnvConfig } from '@next/env';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ChatMessage } from '../../src/lib/ai/spark';

const wireSchema = z.object({ type: z.literal('chatml'), messages: z.tuple([
  z.object({ role: z.literal('system'), content: z.string().min(1) }),
  z.object({ role: z.literal('user'), content: z.string().min(1) }),
  z.object({ role: z.literal('assistant'), content: z.string().min(1) }),
]) }).strict();

async function main(): Promise<void> {
  const project = process.cwd();
  const runDirectory = path.resolve(process.argv[2] || '');
  const prefix = path.join(project, '.taskbook-working', 'lora-real-20261018') + path.sep;
  if (!runDirectory.startsWith(prefix)) throw new Error('INVALID_EXPERIMENT_PATH');
  await readFile(path.join(runDirectory, 'run.json'));
  const output = path.join(runDirectory, 'spark');
  await mkdir(output); // One attempt only; existing output is never overwritten.
  loadEnvConfig(project, true);
  const { chat, AiError } = await import('../../src/lib/ai/spark');
  const raw = await readFile(path.join(project, '.taskbook-working/lora-pilot-20261018/prep-7f984f85cb12/bundle/heldout.messages.jsonl'), 'utf8');
  const wires = raw.trim().split(/\r?\n/u).map((line: string) => wireSchema.parse(JSON.parse(line) as unknown));
  if (wires.length !== 6) throw new Error('HELDOUT_CHANGED');
  const model = process.env.SPARK_MODEL?.trim() || 'lite';
  if (!/^[a-zA-Z0-9_.-]{1,80}$/u.test(model)) throw new Error('MODEL_NAME_INVALID');
  await writeFile(path.join(output, 'protocol.json'), JSON.stringify({
    provider: 'spark', model, samples: 6, requestsPerSample: 1, maxTokens: 192,
    temperature: 0, jsonMode: false, repair: false, fallback: false, timeoutMs: 25_000,
    frozenMessagesSha256: createHash('sha256').update(raw).digest('hex'),
    semanticAcceptance: false,
  }, null, 2), { flag: 'wx' });
  const deadlineAt = Date.now() + 180_000;
  for (const wire of wires) {
    const id = z.object({ source_id: z.string().regex(/^heldout-[0-9]{3}$/u) }).parse(JSON.parse(wire.messages[1].content) as unknown).source_id;
    const messages: ChatMessage[] = wire.messages.slice(0, 2);
    const started = Date.now();
    let result: { id: string; content?: string; error?: string; seconds: number };
    try {
      const answer = await chat(messages, { provider: 'spark', maxTokens: 192, temperature: 0,
        jsonMode: false, timeoutMs: 25_000, deadlineAt });
      result = { id, content: answer.content, seconds: (Date.now() - started) / 1000 };
    } catch (error: unknown) {
      result = { id, error: error instanceof AiError ? error.code : 'RUNTIME_ERROR', seconds: (Date.now() - started) / 1000 };
    }
    await appendFile(path.join(output, 'spark.jsonl'), JSON.stringify(result) + '\n');
    console.log(JSON.stringify({ id, completed: result.content !== undefined, error: result.error }));
  }
}

main().catch((): void => { console.error('SPARK_COMPARISON_FAILED'); process.exitCode = 1; });
