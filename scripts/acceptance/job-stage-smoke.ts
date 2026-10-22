import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), true);

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? '');
  assert.ok(output.startsWith(path.resolve('.taskbook-working') + path.sep), 'New ignored output directory required');
  await mkdir(output, { recursive: false });
  const { prisma } = await import('../../src/lib/prisma');
  const { runStage } = await import('../../src/lib/jobs/workers/lifecycle');
  const { taskLogger } = await import('../../src/lib/jobs/task-logger');
  const { renderPrometheusMetrics } = await import('../../src/lib/observability/metrics');
  const id = `job-stage-smoke-${randomUUID()}`;
  const errors: Array<{ message: string; stage: unknown }> = [];
  const originalLogger = taskLogger.error;
  let cleaned = false;
  try {
    await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: 'isolated-no-login', nickname: '阶段诊断隔离验收' } });
    const content = await prisma.learningContent.create({ data: {
      ownerId: id, contentType: 'DOCUMENT', title: '阶段诊断隔离资料', fileName: 'diagnostic.txt', format: 'TXT', fileSizeBytes: 0n,
      storageKey: `isolated-no-media/${id}`, status: 'READY',
    } });
    taskLogger.error = (message, fields = {}): void => { errors.push({ message, stage: fields.stage }); };
    const checks: Array<{ stage: string; retryExhausted: boolean; persistedState: string }> = [];
    for (const [stage, maxAttempts] of [['deep-extract', 1], ['product-gen', 1], ['deep-extract', 2]] as const) {
      const job = await prisma.asyncJob.create({ data: { contentId: content.id, jobType: 'UNDERSTANDING', traceId: id } });
      const failure = new Error('controlled isolated failure');
      await assert.rejects(runStage({ contentId: content.id, traceId: id, asyncJobId: job.id },
        { name: 'UNDERSTANDING', contentId: content.id, traceId: id, attempts: 1, maxAttempts }, 'light-filter', async (): Promise<void> => {
          await prisma.asyncJob.update({ where: { id: job.id }, data: { stage } });
          throw failure;
        }), (error: unknown): boolean => error === failure);
      const stored = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(stored.stage, stage);
      assert.equal(stored.state, maxAttempts === 1 ? 'FAILED' : 'RUNNING');
      assert.equal(errors.at(-1)?.stage, stage);
      if (maxAttempts === 1) assert.equal(stored.errorReason, failure.message);
      checks.push({ stage, retryExhausted: maxAttempts === 1, persistedState: stored.state });
    }
    const metrics = renderPrometheusMetrics();
    assert.ok(metrics.includes('outcome="failure",queue="UNDERSTANDING",stage="deep-extract"'));
    assert.ok(metrics.includes('outcome="failure",queue="UNDERSTANDING",stage="product-gen"'));
    assert.ok(!metrics.includes('outcome="failure",queue="UNDERSTANDING",stage="light-filter"'));
    await prisma.user.delete({ where: { id } });
    cleaned = true;
    await writeFile(path.join(output, 'result.json'), JSON.stringify({ realPostgresql: true, actualLifecycleHandler: true, controlledCallbackFailures: true,
      noModelRequests: true, noMediaCreated: true, originalExceptionPreserved: true, failureLogsAndMetricsMatched: true, checks, temporaryFixtureCleaned: cleaned }, null, 2));
    console.log('Real lifecycle/database diagnostics passed; temporary fixture cleaned');
  } finally {
    taskLogger.error = originalLogger;
    if (!cleaned) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}

void main().catch((): void => { console.error('Job stage acceptance failed (no raw error)'); process.exitCode = 1; });
