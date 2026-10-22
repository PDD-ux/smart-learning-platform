/** One real ASR chunk, no queue or database; evidence excludes audio/text/signatures. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { getTranscriptionProvider } from '../../src/lib/ai/asr';
import { ffmpegPath } from '../../src/lib/media/ffmpeg';

type RequestEvidence = { phase: string; elapsedMs: number; httpStatus?: number; errorName?: string; causeCode?: string };

function safeCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined;
  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  return typeof cause.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? cause.code : undefined;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const output = path.resolve(process.argv[2] ?? '.taskbook-working/long-video-46m/asr-preflight-new.json');
  await mkdir(path.dirname(output), { recursive: true });
  const audio = path.join(path.dirname(output), `asr-preflight-${randomUUID()}.wav`);
  const provider = getTranscriptionProvider();
  if (provider.name !== 'xunfei' || !provider.isAvailable()) throw new Error('Real configured xunfei required');
  const requests: RequestEvidence[] = [];
  const report: Record<string, unknown> = { status: 'running', scope: 'one real 300-600s audio chunk; no full-video claim',
    checkedAt: new Date().toISOString(), provider: provider.name, requests, audioCleaned: false };
  const save = async (): Promise<void> => { await writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
  const realFetch = globalThis.fetch;
  const started = Date.now();
  const watchdog = setTimeout((): void => {
    report.status = 'timeout';
    report.elapsedMs = Date.now() - started;
    void unlink(audio).catch((): void => undefined).then(async (): Promise<void> => {
      report.audioCleaned = true;
      await save();
      process.exit(2);
    });
  }, 300_000);
  try {
    await save();
    await promisify(execFile)(ffmpegPath(), ['-v', 'error', '-y', '-ss', '300', '-i',
      '.taskbook-working/long-video-46m/clip-46m.mkv', '-t', '300', '-vn', '-ac', '1', '-ar', '16000', audio],
    { timeout: 180_000, windowsHide: true });
    globalThis.fetch = async (input, init): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const row: RequestEvidence = { phase: url.pathname.endsWith('/upload') ? 'upload' : 'getResult', elapsedMs: 0 };
      requests.push(row);
      const requestStarted = Date.now();
      try {
        const response = await realFetch(input, init);
        row.httpStatus = response.status;
        return response;
      } catch (error: unknown) {
        row.errorName = error instanceof Error ? error.name : 'UnknownError';
        row.causeCode = safeCode(error);
        throw error;
      } finally {
        row.elapsedMs = Date.now() - requestStarted;
        await save();
      }
    };
    const result = await provider.transcribe({ contentId: 'video-asr-preflight', traceId: randomUUID(),
      audio: { audioPath: audio, durationSec: 300 } });
    report.status = result.available && result.segments.length > 0 ? 'passed' : 'failed';
    report.segments = result.segments.length;
    report.boundsValid = result.segments.every((segment): boolean => segment.startMs >= 0
      && segment.endMs >= segment.startMs && segment.endMs <= 300_000);
    if (report.boundsValid !== true) report.status = 'failed';
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error: unknown) {
    report.status = 'failed';
    report.errorName = error instanceof Error ? error.name : 'UnknownError';
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    globalThis.fetch = realFetch;
    await unlink(audio).catch((): void => undefined);
    report.audioCleaned = true;
    report.elapsedMs = Date.now() - started;
    await save();
    console.log(JSON.stringify(report));
  }
}

void main().catch((error: unknown): void => {
  console.error(JSON.stringify({ status: 'setup-failed', errorName: error instanceof Error ? error.name : 'UnknownError' }));
  process.exitCode = 1;
});
