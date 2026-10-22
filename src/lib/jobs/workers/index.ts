import { QueueName, registerProcessor, startWorkers } from '@/lib/queue';
import { registerDeepExtractStage } from '@/lib/jobs/pipeline/deep-extract.stage';
import { registerLightFilterStage } from '@/lib/jobs/pipeline/light-filter.stage';
import { registerProductGenStage } from '@/lib/jobs/pipeline/product-gen.stage';
import { contentParseProcessor } from './content-parse.worker';
import { understandingProcessor } from './understanding.worker';
import { productGenProcessor } from './product-gen.worker';

/**
 * Worker 注册入口（tasks.md §2.2）
 * ------------------------------------------------------------
 * 将三类队列与对应处理器绑定，并启动 worker：
 *   - memory 驱动：处理器随 enqueue 直接消费，startWorkers 为幂等空操作；
 *   - bullmq 驱动：为三类队列各起一个 worker。
 *
 * 应用启动时调用 `bootstrapWorkers()` 即可（进程级，调用一次）。
 */

export function registerAllProcessors(): void {
  registerProcessor(QueueName.CONTENT_PARSE, contentParseProcessor);
  registerProcessor(QueueName.UNDERSTANDING, understandingProcessor);
  registerProcessor(QueueName.PRODUCT_GEN, productGenProcessor);
  registerLightFilterStage();
  registerDeepExtractStage();
  registerProductGenStage();
}

export function bootstrapWorkers(): void {
  registerAllProcessors();
  startWorkers();
}

export { contentParseProcessor, understandingProcessor, productGenProcessor };
export { JobNotImplementedError, runStage } from './lifecycle';
