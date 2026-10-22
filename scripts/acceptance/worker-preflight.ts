/** Read-only deployment checks. Never starts consumers or changes Redis/database data. */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import Redis from 'ioredis';
import { z } from 'zod';

loadEnvConfig(process.cwd());
const execute = promisify(execFile);

type Check = { status: 'passed' | 'blocked'; reason?: string; version?: string };

async function checkRedis(): Promise<Check> {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true, connectTimeout: 3_000, maxRetriesPerRequest: 0,
    enableOfflineQueue: false, retryStrategy: null,
  });
  client.on('error', (): void => { /* Do not print connection URLs or credentials. */ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      (async (): Promise<string> => { await client.connect(); return client.info('server'); })(),
      new Promise<never>((_resolve, reject): void => {
        timer = setTimeout((): void => { reject(new Error('deadline')); }, 5_000);
      }),
    ]);
    const version = /^redis_version:(\d+\.\d+\.\d+)/m.exec(info)?.[1];
    if (!version) return { status: 'blocked', reason: 'REDIS_VERSION_UNAVAILABLE' };
    // Deployment spec uses Redis 7; installed BullMQ requires at least Redis 5.
    return Number(version.split('.')[0]) >= 7
      ? { status: 'passed', version }
      : { status: 'blocked', version, reason: 'DEPLOYMENT_REQUIRES_REDIS_7' };
  } catch {
    return { status: 'blocked', reason: 'REDIS_UNREACHABLE' };
  } finally {
    if (timer) clearTimeout(timer);
    client.disconnect();
  }
}

async function checkDocker(): Promise<Check> {
  try {
    const { stdout } = await execute('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 5_000 });
    const version = stdout.trim();
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) return { status: 'blocked', reason: 'DOCKER_ENGINE_UNAVAILABLE' };
    return Number(version.split('.')[0]) >= 24
      ? { status: 'passed', version }
      : { status: 'blocked', version, reason: 'DEPLOYMENT_REQUIRES_DOCKER_24' };
  } catch {
    return { status: 'blocked', reason: 'DOCKER_ENGINE_UNAVAILABLE' };
  }
}

async function checkInference(url: string): Promise<Check> {
  try {
    const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(5_000) });
    const schema = z.object({ status: z.literal('ok'), device: z.literal('ascend'),
      mindsporeAvailable: z.literal(true), modelsLoaded: z.literal(true), mock: z.literal(false),
      ocrFallbackAvailable: z.literal(false) });
    if (!response.ok || !schema.safeParse(await response.json()).success) {
      return { status: 'blocked', reason: 'REAL_ASCEND_NOT_READY' };
    }
    return { status: 'passed' };
  } catch {
    return { status: 'blocked', reason: 'INFERENCE_UNREACHABLE' };
  }
}

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? '.taskbook-working/worker-preflight/result.json');
  const inferenceUrl = process.argv[3] ?? process.env.ASCEND_INFER_URL ?? 'http://127.0.0.1:8001';
  const [redis, docker, inference] = await Promise.all([checkRedis(), checkDocker(), checkInference(inferenceUrl)]);
  const status = [redis, docker, inference].every((check): boolean => check.status === 'passed') ? 'ready' : 'blocked';
  const result = { status, checkedAt: new Date().toISOString(), scope: 'Read-only prerequisites; no worker or pipeline acceptance',
    required: { redis: '7.x per DEPLOY', bullmqRedisMinimum: '5.0.0 per installed package', docker: '24+', inference: 'Real Ascend with mock and OCR fallback disabled' },
    checks: { redis, docker, inference }, consumersStarted: false, queueOrDatabaseWrites: false };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (status !== 'ready') process.exitCode = 1;
}

void main().catch((): void => {
  console.error('Preflight could not save its report');
  process.exitCode = 1;
});
