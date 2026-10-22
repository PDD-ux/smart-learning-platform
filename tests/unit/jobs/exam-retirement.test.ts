import { beforeEach, expect, it, vi } from 'vitest';
import type { JobContext, JobPayload } from '@/lib/queue';
const lifecycle = vi.hoisted(() => ({ runStage: vi.fn() }));
vi.mock('@/lib/jobs/workers/lifecycle', (): object => ({ runStage: lifecycle.runStage, JobNotImplementedError: class extends Error {} }));
import { productGenProcessor } from '@/lib/jobs/workers/product-gen.worker';

const context: JobContext = { name: 'PRODUCT_GEN', jobId: 'late-exam-test', attempts: 1, maxAttempts: 4, traceId: 'test', contentId: '' };
beforeEach((): void => { vi.clearAllMocks(); lifecycle.runStage.mockResolvedValue(undefined); });

it.each([{ contentId: '', traceId: 'test', stage: 'exam-generation', examGenerationId: 'late' }, { contentId: '', traceId: 'test', stage: 'exam-generation' }, { contentId: '', traceId: 'test', stage: 'exam-generation', examGenerationId: { invalid: true }, asyncJobId: 'do-not-mark-success' }])('discards repeated legacy exam payload without entering any persistent lifecycle', async (payload): Promise<void> => {
  for (let repeat = 0; repeat < 2; repeat++) await productGenProcessor(payload, context);
  expect(lifecycle.runStage).not.toHaveBeenCalled();
});

it('keeps PRODUCT_GEN available for non-exam work', async (): Promise<void> => {
  const payload: JobPayload = { contentId: 'real-content', traceId: 'test', stage: 'product-gen' };
  await productGenProcessor(payload, context);
  expect(lifecycle.runStage).toHaveBeenCalledExactlyOnceWith(payload, context, 'product-gen', expect.any(Function));
});
