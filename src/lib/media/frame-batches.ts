import type { FrameInput } from '@/lib/ai/gateway';
import { readFileBase64 } from '@/lib/media/frame-bytes';
import type { ExtractedFrame } from '@/lib/media/ffmpeg';

export const MAX_INFERENCE_FRAMES = 120;
export const MAX_INFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INFERENCE_BATCH_BYTES = 16 * 1024 * 1024;

type FrameBatchLimits = {
  maxFrames?: number;
  maxBytes?: number;
};

/**
 * Read frame files lazily and yield requests that stay below MindSpore's frame
 * count and payload limits. Only the current batch is held as base64 in memory.
 */
export async function* readFrameBatches(
  frames: ExtractedFrame[],
  limits: FrameBatchLimits = {},
): AsyncGenerator<FrameInput[]> {
  const maxFrames = Math.min(MAX_INFERENCE_FRAMES, Math.max(1, Math.floor(limits.maxFrames ?? MAX_INFERENCE_FRAMES)));
  const maxBytes = Math.min(MAX_INFERENCE_BATCH_BYTES, Math.max(1, Math.floor(limits.maxBytes ?? MAX_INFERENCE_BATCH_BYTES)));
  let batch: FrameInput[] = [];
  let batchBytes = 0;

  for (const frame of frames) {
    const imageBase64 = await readFileBase64(frame.filePath);
    const imageBytes = Math.floor((imageBase64.length * 3) / 4);
    if (imageBytes > MAX_INFERENCE_IMAGE_BYTES) {
      throw new Error(`抽取帧超过推理服务单张图片上限：frameIndex=${frame.frameIndex}`);
    }

    if (
      batch.length > 0 &&
      (batch.length >= maxFrames || batchBytes + imageBytes > maxBytes)
    ) {
      yield batch;
      batch = [];
      batchBytes = 0;
    }

    batch.push({
      frameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
      imageBase64,
    });
    batchBytes += imageBytes;
  }

  if (batch.length > 0) yield batch;
}
