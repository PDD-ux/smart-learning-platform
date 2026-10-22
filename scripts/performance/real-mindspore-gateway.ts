/** Read-only gateway diagnostic. Requires an authenticated SSH tunnel in env. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getInferenceGateway, type FrameInput, type CallOptions } from '../../src/lib/ai/gateway';

async function main(): Promise<void> {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw new Error('Provide frames directory and output JSON path');
  const frames: FrameInput[] = readdirSync(directory).filter((name): boolean => /^frame_.*\.jpg$/.test(name))
    .sort().map((name, frameIndex): FrameInput => ({
      frameIndex, timestampMs: 0, imageBase64: readFileSync(resolve(directory, name)).toString('base64'),
    }));
  const gateway = getInferenceGateway();
  const httpRequests: Array<{ frames: number; indices: number[]; durationMs: number; status?: number }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init): Promise<Response> => {
    if (!String(input).endsWith('/detect_text')) return realFetch(input, init);
    const body = JSON.parse(String(init?.body)) as { frames: FrameInput[] };
    const sample: typeof httpRequests[number] = {
      frames: body.frames.length, indices: body.frames.map((frame): number => frame.frameIndex), durationMs: 0,
    };
    httpRequests.push(sample);
    const started = performance.now();
    try {
      const response = await realFetch(input, init);
      sample.status = response.status;
      return response;
    } finally {
      sample.durationMs = Math.round(performance.now() - started);
    }
  };
  const rows: Array<{ scope: string; operation: string; durationMs: number; fallbacks: string[]; response: unknown }> = [];
  const health = await gateway.health();
  if (health.device !== 'ascend' || health.mock || !health.modelsLoaded) throw new Error('Ascend health gate failed');
  for (const [scope, inputs] of [['single', [frames[2]]], ['batch16', frames]] as const) {
    for (const operation of ['classify', 'detectText', 'selectFrames'] as const) {
      const fallbacks: string[] = [];
      const options: CallOptions = { traceId: `accept-20261008-${scope}-${operation}`,
        onFallback: (reason): void => { fallbacks.push(reason); } };
      const started = performance.now();
      const response = await gateway[operation]([...inputs], options);
      rows.push({ scope, operation, durationMs: Math.round(performance.now() - started), fallbacks, response });
      writeFileSync(output, JSON.stringify({ status: 'running', health, rows, httpRequests }, null, 2) + '\n');
    }
  }
  const degraded = rows.some((row): boolean => row.fallbacks.length > 0);
  const report = { checkedAt: new Date().toISOString(), status: degraded ? 'degraded' : 'executed',
    scope: 'Windows TypeScript gateway through SSH tunnel; not public ingress or full video',
    timeoutMs: Number(process.env.ASCEND_INFER_TIMEOUT_MS ?? 8000), health, rows, httpRequests };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, requests: rows.length, degraded }));
  process.exitCode = degraded ? 1 : 0;
}

main().catch((error: unknown): void => {
  console.error(JSON.stringify({ status: 'failed', errorType: error instanceof Error ? error.name : 'unknown' }));
  process.exitCode = 1;
});
