/** Exercise actual configured provider on a bounded WAV; no DB or cloud fallback. */
import { loadEnvConfig } from '@next/env';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const output = process.argv[2];
  if (!output) throw new Error('New output JSON required');
  await mkdir(path.dirname(output), { recursive: true });
  // Refuse overwrites before launching a model.
  await writeFile(output, JSON.stringify({ status: 'running' }), { flag: 'wx' });
  const { transcribe, getTranscriptionProvider } = await import('../../src/lib/ai/asr');
  if (getTranscriptionProvider().name !== 'funasr-local') throw new Error('Local provider required; no paid calls');
  const started = performance.now();
  const result = await transcribe({ contentId: 'isolated-local-asr',
    audio: { audioPath: path.resolve(process.argv[3] ?? '.taskbook-working/local-asr/sample-535-565.wav'), durationSec: Number(process.argv[4] ?? 30) } });
  const passed = result.provider === 'funasr-local' && result.available && result.segments.length > 0;
  await writeFile(output, JSON.stringify({ status: passed ? 'passed' : 'failed', durationMs: Math.round(performance.now() - started),
    cloudAsrCalled: false, databaseWrites: false, result }, null, 2));
  console.log(JSON.stringify({ passed, provider: result.provider, segments: result.segments.length }));
  process.exitCode = passed ? 0 : 1;
}
void main().catch((): void => { console.error('Local ASR acceptance failed'); process.exitCode = 1; });
