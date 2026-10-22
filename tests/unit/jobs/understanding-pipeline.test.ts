import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentUpdate: vi.fn(),
  contentFindUnique: vi.fn(),
  jobCreate: vi.fn(),
  enqueue: vi.fn(),
  updateJobStage: vi.fn(),
  recordJobErrorReason: vi.fn(),
  getAsrStatus: vi.fn(),
  gatewayHealth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { update: mocks.contentUpdate, findUnique: mocks.contentFindUnique },
    asyncJob: { create: mocks.jobCreate },
    $transaction: (fn: (tx: unknown) => unknown): unknown => fn({
      asyncJob: { create: mocks.jobCreate }, learningContent: { update: mocks.contentUpdate },
    }),
  },
}));

vi.mock('@/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue');
  return { ...actual, enqueue: mocks.enqueue };
});

vi.mock('@/lib/jobs/async-job', () => ({
  updateJobStage: mocks.updateJobStage,
  recordJobErrorReason: mocks.recordJobErrorReason,
}));

vi.mock('@/lib/ai/asr', () => ({ getAsrStatus: mocks.getAsrStatus }));

vi.mock('@/lib/ai/gateway', () => ({
  getInferenceGateway: () => ({ health: mocks.gatewayHealth }),
}));

import {
  __resetPipelineStagesForTest,
  enqueueUnderstanding,
  registerPipelineStage,
  runUnderstandingPipeline,
} from '@/lib/jobs/pipeline/understanding-pipeline';
import { QueueName, type JobContext } from '@/lib/queue';

/**
 * UnderstandingPipeline 单测（tasks.md §6.2）
 */

function makeCtx(): JobContext {
  return {
    name: QueueName.UNDERSTANDING,
    attempts: 1,
    maxAttempts: 4,
    traceId: 't1',
    contentId: 'c1',
  };
}

const payload = { contentId: 'c1', traceId: 't1', asyncJobId: 'j1' };

describe('runUnderstandingPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPipelineStagesForTest();
    mocks.contentUpdate.mockResolvedValue({});
    mocks.contentFindUnique.mockResolvedValue({ contentType: 'VIDEO' });
    mocks.jobCreate.mockResolvedValue({ id: 'j1' });
    mocks.enqueue.mockResolvedValue('mem_1');
    mocks.updateJobStage.mockResolvedValue({});
    mocks.recordJobErrorReason.mockResolvedValue({});
    mocks.getAsrStatus.mockReturnValue({ available: true, provider: 'xunfei' });
    mocks.gatewayHealth.mockResolvedValue({ status: 'ok', device: 'cpu', modelsLoaded: false, mock: true });
  });

  it('runs light-filter → deep-extract → product-gen then marks completed', async () => {
    const order: string[] = [];
    registerPipelineStage('light-filter', async () => { order.push('light-filter'); });
    registerPipelineStage('deep-extract', async () => { order.push('deep-extract'); });
    registerPipelineStage('product-gen', async () => { order.push('product-gen'); });

    await runUnderstandingPipeline(payload, makeCtx());

    expect(order).toEqual(['light-filter', 'deep-extract', 'product-gen']);
    expect(mocks.contentUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'RUNNING' },
    });
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'COMPLETED' },
    });
    expect(mocks.updateJobStage).toHaveBeenCalledWith('j1', 'completed');
  });

  it('marks video understanding failed and skips semantic stages when ASR is unavailable', async () => {
    mocks.getAsrStatus.mockReturnValue({ available: false, provider: 'none', reason: '未配置' });
    const phases: string[] = [];
    registerPipelineStage('light-filter', async () => { phases.push('light-filter'); });
    registerPipelineStage('deep-extract', async () => { phases.push('deep-extract'); });
    registerPipelineStage('product-gen', async () => { phases.push('product-gen'); });

    await expect(runUnderstandingPipeline(payload, makeCtx())).rejects.toThrow('语音识别不可用');

    expect(phases).toEqual(['light-filter']);
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'FAILED' },
    });
    expect(mocks.recordJobErrorReason).toHaveBeenCalledWith(
      'j1',
      expect.stringContaining('语音识别不可用'),
    );
  });

  it('does not treat the mock ASR provider as real video understanding', async () => {
    mocks.getAsrStatus.mockReturnValue({ available: true, provider: 'mock' });
    const phases: string[] = [];
    registerPipelineStage('light-filter', async () => { phases.push('light-filter'); });
    registerPipelineStage('deep-extract', async () => { phases.push('deep-extract'); });
    registerPipelineStage('product-gen', async () => { phases.push('product-gen'); });

    await expect(runUnderstandingPipeline(payload, makeCtx())).rejects.toThrow('mock 演示模式');

    expect(phases).toEqual(['light-filter']);
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'FAILED' },
    });
  });

  it('fails after runtime ASR failure even when the provider passed the initial check', async () => {
    const phases: string[] = [];
    registerPipelineStage('light-filter', async ({ degraded }) => {
      phases.push('light-filter');
      degraded.asr = true;
      degraded.asrReason = '讯飞 ASR 轮询超时';
    });
    registerPipelineStage('deep-extract', async () => { phases.push('deep-extract'); });
    registerPipelineStage('product-gen', async () => { phases.push('product-gen'); });

    await expect(runUnderstandingPipeline(payload, makeCtx())).rejects.toThrow('讯飞 ASR 轮询超时');

    expect(phases).toEqual(['light-filter']);
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'FAILED' },
    });
    expect(mocks.updateJobStage).not.toHaveBeenCalledWith('j1', 'completed');
    expect(mocks.recordJobErrorReason).toHaveBeenCalledWith('j1', expect.stringContaining('讯飞 ASR 轮询超时'));
  });

  it('still runs product-gen for documents when ASR is unavailable', async () => {
    mocks.contentFindUnique.mockResolvedValue({ contentType: 'DOCUMENT' });
    mocks.getAsrStatus.mockReturnValue({ available: false, provider: 'none', reason: '未配置' });
    const phases: string[] = [];
    registerPipelineStage('light-filter', async () => { phases.push('light-filter'); });
    registerPipelineStage('deep-extract', async () => { phases.push('deep-extract'); });
    registerPipelineStage('product-gen', async () => { phases.push('product-gen'); });

    await runUnderstandingPipeline(payload, makeCtx());

    expect(phases).toEqual(['light-filter', 'deep-extract', 'product-gen']);
  });

  it('continues with mock degradation when inference is unreachable', async () => {
    mocks.gatewayHealth.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const phases: string[] = [];
    registerPipelineStage('light-filter', async () => { phases.push('light-filter'); });
    registerPipelineStage('deep-extract', async () => { phases.push('deep-extract'); });
    registerPipelineStage('product-gen', async () => { phases.push('product-gen'); });

    await runUnderstandingPipeline(payload, makeCtx());

    expect(phases).toEqual(['light-filter', 'deep-extract', 'product-gen']);
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'COMPLETED' },
    });
  });

  it('marks failed and rethrows when a stage errors', async () => {
    registerPipelineStage('light-filter', async () => {
      throw new Error('stage boom');
    });

    await expect(runUnderstandingPipeline(payload, makeCtx())).rejects.toThrow('stage boom');
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'FAILED' },
    });
  });

  it('marks the pipeline failed when a required stage is not registered', async () => {
    await expect(runUnderstandingPipeline(payload, makeCtx())).rejects.toThrow('理解阶段未注册：light-filter');
    expect(mocks.contentUpdate).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'FAILED' },
    });
  });
});

describe('enqueueUnderstanding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobCreate.mockResolvedValue({ id: 'j9' });
    mocks.contentUpdate.mockResolvedValue({});
    mocks.enqueue.mockResolvedValue('mem_9');
  });

  it('creates an AsyncJob, sets RUNNING and enqueues the pipeline', async () => {
    const result = await enqueueUnderstanding('c1', 'trace-1');
    expect(result).toEqual({ jobId: 'j9', traceId: 'trace-1' });
    expect(mocks.jobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobType: 'UNDERSTANDING', contentId: 'c1', traceId: 'trace-1' }),
      }),
    );
    expect(mocks.contentUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { understandingStatus: 'RUNNING' },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      QueueName.UNDERSTANDING,
      expect.objectContaining({ contentId: 'c1', asyncJobId: 'j9', stage: 'light-filter' }),
    );
  });
});
