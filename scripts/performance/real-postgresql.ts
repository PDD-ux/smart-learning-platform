import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { PrismaClient } from '@prisma/client';

const LEARNER_COUNT = 100;
const NOTES_PER_LEARNER = 1_000;
const SEARCH_P95_LIMIT_MS = 1_000;
const SEARCH_TERM = '性能笔记';

interface TimedOperation {
  readonly durationMs: number;
  readonly failed: boolean;
}

interface IndexRow {
  readonly indexname: string;
  readonly indexdef: string;
}

interface BenchmarkResult {
  readonly runId: string;
  readonly learnerCount: number;
  readonly notesSeeded: number;
  readonly concurrentReadWriteP95Ms: number;
  readonly searchP95Ms: number;
  readonly searchTargetMs: number;
  readonly trigramIndexPresent: boolean;
  readonly failedOperations: number;
  readonly passed: boolean;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

async function timeOperation(operation: () => Promise<void>): Promise<TimedOperation> {
  const startedAt = performance.now();
  try {
    await operation();
    return { durationMs: performance.now() - startedAt, failed: false };
  } catch {
    return { durationMs: performance.now() - startedAt, failed: true };
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const runId = `perf-${Date.now()}-${randomUUID()}`;
  const learnerIds: string[] = [];

  try {
    const learners = await Promise.all(
      Array.from({ length: LEARNER_COUNT }, (_, index) =>
        prisma.user.create({
          data: {
            email: `${runId}-${index}@performance.invalid`,
            passwordHash: 'performance-benchmark-not-for-login',
            nickname: `性能学习者 ${index + 1}`,
          },
          select: { id: true },
        }),
      ),
    );
    learnerIds.push(...learners.map(({ id }) => id));

    const contents = await Promise.all(
      learnerIds.map((ownerId, index) =>
        prisma.learningContent.create({
          data: {
            ownerId,
            contentType: 'DOCUMENT',
            title: `性能内容 ${index + 1}`,
            fileName: `performance-${index + 1}.md`,
            format: 'MD',
            fileSizeBytes: BigInt(1),
            storageKey: `performance/${runId}/${index + 1}.md`,
            status: 'READY',
          },
          select: { id: true, ownerId: true },
        }),
      ),
    );

    await Promise.all(
      contents.map(async ({ id: contentId, ownerId }, learnerIndex) => {
        await prisma.flashcard.create({
          data: {
            contentId,
            ownerId,
            front: `性能闪卡 ${learnerIndex + 1}`,
            back: '用于验证真实 PostgreSQL 并发读写。',
          },
        });

        for (let offset = 0; offset < NOTES_PER_LEARNER; offset += 100) {
          await prisma.note.createMany({
            data: Array.from({ length: 100 }, (_, batchIndex) => ({
              contentId,
              ownerId,
              content: `性能笔记 ${learnerIndex + 1}-${offset + batchIndex + 1} ${SEARCH_TERM} PostgreSQL 全文检索`,
              ref: { type: 'document', page: 1, blockIndex: offset + batchIndex },
            })),
          });
        }
      }),
    );

    const byLearner = new Map(contents.map(({ id, ownerId }) => [ownerId, id]));
    const readWriteSamples = await Promise.all(
      learnerIds.map((ownerId, learnerIndex) =>
        timeOperation(async () => {
          const contentId = byLearner.get(ownerId);
          if (!contentId) {
            throw new Error('Missing benchmark content.');
          }
          const [notes, cards] = await Promise.all([
            prisma.note.findMany({ where: { ownerId, contentId }, take: 20, select: { id: true } }),
            prisma.flashcard.findMany({ where: { ownerId, contentId }, take: 1, select: { id: true } }),
          ]);
          const card = cards[0];
          if (notes.length === 0 || !card) {
            throw new Error('Missing benchmark fixtures.');
          }
          await Promise.all([
            prisma.note.create({
              data: {
                contentId,
                ownerId,
                content: `并发写入 ${learnerIndex + 1} ${SEARCH_TERM}`,
                ref: { type: 'document', page: 1, blockIndex: NOTES_PER_LEARNER + 1 },
              },
            }),
            prisma.flashcard.update({
              where: { id: card.id },
              data: { nextReviewAt: new Date() },
            }),
          ]);
        }),
      ),
    );

    const searchSamples = await Promise.all(
      learnerIds.map((ownerId) =>
        timeOperation(async () => {
          await prisma.$queryRaw<{ readonly id: string }[]>`
            SELECT "id"
            FROM "Note"
            WHERE "ownerId" = ${ownerId}
              AND "content" ILIKE ${`%${SEARCH_TERM}%`}
            LIMIT 20
          `;
        }),
      ),
    );

    const indexes = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Note'
    `;
    const trigramIndexPresent = indexes.some(({ indexdef }) => indexdef.includes('gin_trgm_ops'));
    const failedOperations = [...readWriteSamples, ...searchSamples].filter(({ failed }) => failed).length;
    const result: BenchmarkResult = {
      runId,
      learnerCount: LEARNER_COUNT,
      notesSeeded: LEARNER_COUNT * NOTES_PER_LEARNER,
      concurrentReadWriteP95Ms: percentile(readWriteSamples.map(({ durationMs }) => durationMs), 0.95),
      searchP95Ms: percentile(searchSamples.map(({ durationMs }) => durationMs), 0.95),
      searchTargetMs: SEARCH_P95_LIMIT_MS,
      trigramIndexPresent,
      failedOperations,
      passed: failedOperations === 0 && percentile(searchSamples.map(({ durationMs }) => durationMs), 0.95) < SEARCH_P95_LIMIT_MS,
    };
    console.info(`[perf] real-postgresql ${JSON.stringify(result)}`);
    if (!result.passed) {
      process.exitCode = 1;
    }
  } finally {
    if (learnerIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: learnerIds } } });
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown benchmark failure.';
  console.error(`[perf] real-postgresql failed: ${message}`);
  process.exitCode = 1;
});
