import { Queue, Worker, type JobsOptions } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { taskLogger } from '@/lib/jobs/task-logger';

/**
 * 队列基础设施（tasks.md §2.2）
 * ------------------------------------------------------------
 * 定义 CONTENT_PARSE（解析）/ UNDERSTANDING（端云理解流水线）/ PRODUCT_GEN（产物生成）
 * 三类队列与统一 worker 脚手架，配置重试与失败处理。
 *
 * 双驱动（spec/03-ARCHITECTURE.md §3.4）：
 *   - `bullmq`：生产方案，基于 Redis（重试/退避/保留策略由 BullMQ 托管）；
 *   - `memory`：MVP 进程内队列，保留同一套接口，无需 Redis 即可跑通全链路。
 *
 * 驱动选择：`QUEUE_DRIVER` 环境变量；未设置时生产用 bullmq、其余用 memory。
 */

export const QueueName = {
  CONTENT_PARSE: 'CONTENT_PARSE',
  UNDERSTANDING: 'UNDERSTANDING',
  PRODUCT_GEN: 'PRODUCT_GEN',
} as const;

export type QueueNameValue = (typeof QueueName)[keyof typeof QueueName];

export const ALL_QUEUES: QueueNameValue[] = [
  QueueName.CONTENT_PARSE,
  QueueName.UNDERSTANDING,
  QueueName.PRODUCT_GEN,
];

export type JobPayload = {
  contentId: string;
  traceId: string;
  /** 关联 AsyncJob 记录 ID（可选：无数据库时任务仍可运行） */
  asyncJobId?: string;
  /** 流水线阶段（可选，供日志与状态机使用） */
  stage?: string;
  [k: string]: unknown;
};

/** worker 运行时上下文：任务标识、重试次数、traceId 透传 */
export type JobContext = {
  name: QueueNameValue;
  jobId?: string;
  /** 当前是第几次尝试（1-based） */
  attempts: number;
  /** 最大尝试次数（含首次） */
  maxAttempts: number;
  traceId: string;
  contentId: string;
};

export type JobProcessor = (payload: JobPayload, ctx: JobContext) => Promise<void>;

export type QueueDriver = 'memory' | 'bullmq';

/** 解析驱动：QUEUE_DRIVER 显式指定优先，否则生产 bullmq / 其他 memory */
export function getQueueDriver(): QueueDriver {
  const raw = (process.env.QUEUE_DRIVER ?? '').trim().toLowerCase();
  if (raw === 'bullmq') return 'bullmq';
  if (raw === 'memory') return 'memory';
  return process.env.NODE_ENV === 'production' ? 'bullmq' : 'memory';
}

function intEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function queueConfig() {
  return {
    concurrency: Math.max(1, intEnv('QUEUE_CONCURRENCY', 4)),
    /** 额外重试次数（不含首次） */
    retries: intEnv('QUEUE_RETRY_MAX', 3),
    backoffMs: intEnv('QUEUE_RETRY_BACKOFF_MS', 5_000),
    removeOnComplete: intEnv('QUEUE_REMOVE_ON_COMPLETE', 100),
    removeOnFail: intEnv('QUEUE_REMOVE_ON_FAIL', 500),
  };
}

// ---------------------------------------------------------------------------
// 进程内（memory）驱动状态：使用 globalThis 保证开发热重载不丢队列
// ---------------------------------------------------------------------------

type MemoryJob = {
  id: string;
  name: QueueNameValue;
  payload: JobPayload;
  /** 已完成的尝试次数 */
  attempts: number;
};

type QueueState = {
  processors: Map<QueueNameValue, JobProcessor>;
  pending: MemoryJob[];
  active: number;
  scheduled: number;
  seq: number;
};

const globalForQueue = globalThis as unknown as { __slpQueueState?: QueueState };

function state(): QueueState {
  if (!globalForQueue.__slpQueueState) {
    globalForQueue.__slpQueueState = {
      processors: new Map<QueueNameValue, JobProcessor>(),
      pending: [],
      active: 0,
      scheduled: 0,
      seq: 0,
    };
  }
  return globalForQueue.__slpQueueState;
}

/** 注册某队列的处理器（memory 驱动直接消费；bullmq 驱动由 worker 消费） */
export function registerProcessor(name: QueueNameValue, processor: JobProcessor): void {
  state().processors.set(name, processor);
}

// ---------------------------------------------------------------------------
// 入队
// ---------------------------------------------------------------------------

function jobOptions(): JobsOptions {
  const { retries, backoffMs, removeOnComplete, removeOnFail } = queueConfig();
  return {
    attempts: retries + 1,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete,
    removeOnFail,
  };
}

/**
 * 入队一个任务
 * @returns 任务 ID（memory 为本地 ID，bullmq 为 BullMQ job id）
 */
export async function enqueue(name: QueueNameValue, payload: JobPayload): Promise<string> {
  if (getQueueDriver() === 'bullmq') {
    const job = await getQueue(name).add(name, payload, jobOptions());
    return String(job.id);
  }
  return enqueueMemory(name, payload);
}

function enqueueMemory(name: QueueNameValue, payload: JobPayload): string {
  const st = state();
  const id = `mem_${Date.now().toString(36)}_${++st.seq}`;
  st.pending.push({ id, name, payload, attempts: 0 });
  queueMicrotask(() => void pump());
  return id;
}

async function pump(): Promise<void> {
  const st = state();
  const { concurrency } = queueConfig();
  while (st.active < concurrency && st.pending.length > 0) {
    const job = st.pending.shift();
    if (!job) break;
    st.active += 1;
    void runMemoryJob(job).finally(() => {
      st.active -= 1;
      void pump();
    });
  }
}

async function runMemoryJob(job: MemoryJob): Promise<void> {
  const st = state();
  const processor = st.processors.get(job.name);
  const { retries, backoffMs } = queueConfig();
  const maxAttempts = retries + 1;
  const attempt = job.attempts + 1;

  if (!processor) {
    taskLogger.warn('queue: no processor registered', {
      queue: job.name,
      jobId: job.id,
      contentId: job.payload.contentId,
      traceId: job.payload.traceId,
    });
    return;
  }

  const ctx: JobContext = {
    name: job.name,
    jobId: job.id,
    attempts: attempt,
    maxAttempts,
    traceId: job.payload.traceId,
    contentId: job.payload.contentId,
  };

  try {
    await processor(job.payload, ctx);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (attempt < maxAttempts) {
      const delay = backoffMs * 2 ** (attempt - 1);
      st.scheduled += 1;
      taskLogger.warn('queue: memory job retry scheduled', {
        queue: job.name,
        jobId: job.id,
        attempt,
        maxAttempts,
        delayMs: delay,
        error: reason,
      });
      setTimeout(() => {
        st.scheduled -= 1;
        st.pending.push({ ...job, attempts: attempt });
        void pump();
      }, delay);
    } else {
      taskLogger.error('queue: memory job failed permanently', {
        queue: job.name,
        jobId: job.id,
        attempts: attempt,
        error: reason,
      });
    }
  }
}

/** 等待进程内队列全部结束（进行中 + 待处理 + 已排定重试） */
export async function drainQueue(): Promise<void> {
  const st = state();
  while (st.active > 0 || st.pending.length > 0 || st.scheduled > 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ---------------------------------------------------------------------------
// BullMQ 驱动
// ---------------------------------------------------------------------------

const globalForQueues = globalThis as unknown as {
  __slpQueues?: Partial<Record<QueueNameValue, Queue<JobPayload>>>;
};

export function getQueue(name: QueueNameValue): Queue<JobPayload> {
  const store = globalForQueues.__slpQueues ?? (globalForQueues.__slpQueues = {});
  if (!store[name]) {
    store[name] = new Queue<JobPayload>(name, { connection: getRedis() });
  }
  return store[name]!;
}

/** 构造 BullMQ worker：统一注入 JobContext 并交给已注册处理器 */
export function createWorker(name: QueueNameValue): Worker<JobPayload> {
  const { concurrency } = queueConfig();
  const worker = new Worker<JobPayload>(
    name,
    async (job) => {
      const processor = state().processors.get(name);
      if (!processor) {
        taskLogger.warn('queue: no processor registered', { queue: name, jobId: String(job.id) });
        return;
      }
      const ctx: JobContext = {
        name,
        jobId: String(job.id),
        attempts: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
        traceId: job.data.traceId,
        contentId: job.data.contentId,
      };
      await processor(job.data, ctx);
    },
    {
      connection: getRedis(),
      concurrency,
      lockDuration: 30_000,
    },
  );
  worker.on('failed', (job, err) => {
    taskLogger.error('queue: bullmq job failed', {
      queue: name,
      jobId: job?.id,
      error: err.message,
    });
  });
  return worker;
}

/**
 * 启动 worker：memory 驱动下处理器已随 enqueue 直接消费，无需启动；
 * bullmq 驱动下为三类队列各起一个 worker。
 */
export function startWorkers(): void {
  if (getQueueDriver() !== 'bullmq') {
    taskLogger.info('queue: memory driver active (in-process), no external worker needed');
    return;
  }
  for (const name of ALL_QUEUES) {
    createWorker(name);
  }
  taskLogger.info('queue: bullmq workers started', { queues: ALL_QUEUES.join(',') });
}

/** 测试辅助：重置进程内队列状态 */
export function __resetQueueForTest(): void {
  const st = state();
  st.processors.clear();
  st.pending.length = 0;
  st.active = 0;
  st.scheduled = 0;
  st.seq = 0;
}
