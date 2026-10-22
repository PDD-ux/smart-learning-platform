import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { TranscribeInput, TranscribeResult, TranscriptionProvider } from './asr';
import { TIMEOUTS } from '@/lib/config';

export function localAsrConfigured(): boolean {
  return Boolean(process.env.ASR_LOCAL_PYTHON?.trim() && process.env.ASR_LOCAL_MODEL_DIR?.trim());
}

export function parseLocalTranscript(stdout: string, expectedSeconds?: number | null): TranscribeResult['segments'] {
  const result = z.object({
    durationMs: z.number().int().positive().max(300_000),
    segments: z.array(z.object({ seq: z.number().int().nonnegative(), startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(), text: z.string().trim().min(1).max(10000) }).strict()).max(2000),
  }).strict().parse(JSON.parse(stdout) as unknown);
  if (expectedSeconds != null && (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0 ||
    Math.abs(result.durationMs - expectedSeconds * 1000) > 1000)) throw new Error('Invalid audio duration');
  let previous = 0;
  result.segments.forEach((segment, index): void => {
    if (segment.seq !== index || segment.startMs < previous || segment.endMs <= segment.startMs ||
      segment.endMs > result.durationMs) throw new Error('Invalid local ASR timing');
    previous = segment.endMs;
  });
  return result.segments;
}

let tail: Promise<void> = Promise.resolve();

export class LocalTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'funasr-local';
  isAvailable(): boolean { return localAsrConfigured(); }
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const failure = (): TranscribeResult => ({ available: false, provider: this.name, segments: [],
      reason: '本地ASR不可用：请检查隔离Python、模型和音频，未调用付费后备服务。' });
    if (!this.isAvailable() || !input.audio.audioPath) return failure();
    const previous = tail;
    let release: () => void = (): void => undefined;
    tail = new Promise<void>((resolve): void => { release = resolve; });
    await previous;
    try {
      const audio = await stat(input.audio.audioPath);
      if (!audio.isFile() || audio.size <= 0 || audio.size > 10 * 1024 * 1024) return failure();
      const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'development' };
      for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
        if (process.env[key]) environment[key] = process.env[key];
      }
      environment.PYTHONIOENCODING = 'utf-8';
      const stdout = await new Promise<string>((resolve, reject): void => {
        execFile(process.env.ASR_LOCAL_PYTHON!.trim(), [path.resolve('services/local-asr/transcribe.py'),
          '--audio', path.resolve(input.audio.audioPath!), '--model-root', path.resolve(process.env.ASR_LOCAL_MODEL_DIR!.trim())],
        { timeout: TIMEOUTS.LOCAL_ASR_MS, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: environment },
        (error, output): void => { if (error) reject(new Error('Local ASR process failed')); else resolve(output); });
      });
      return { available: true, provider: this.name, segments: parseLocalTranscript(stdout, input.audio.durationSec) };
    } catch { return failure(); }
    finally { release(); }
  }
}
