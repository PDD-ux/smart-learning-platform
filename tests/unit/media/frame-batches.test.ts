import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFileBase64 = vi.hoisted(() => vi.fn());

vi.mock('@/lib/media/frame-bytes', () => ({ readFileBase64 }));

import { MAX_INFERENCE_BATCH_BYTES, MAX_INFERENCE_FRAMES, readFrameBatches } from '@/lib/media/frame-batches';
import type { ExtractedFrame } from '@/lib/media/ffmpeg';

function frames(count: number): ExtractedFrame[] {
  return Array.from({ length: count }, (_, index) => ({
    frameIndex: index,
    timestampMs: index * 2_000,
    filePath: `frame-${index}`,
  }));
}

describe('readFrameBatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileBase64.mockResolvedValue('AAAA');
  });

  it('splits requests at the service frame-count limit', async () => {
    const batches: Awaited<ReturnType<typeof collectBatches>> = await collectBatches(frames(121));

    expect(batches.map((batch) => batch.length)).toEqual([MAX_INFERENCE_FRAMES, 1]);
    expect(batches.flat().map((frame) => frame.frameIndex)).toEqual(
      Array.from({ length: 121 }, (_, index) => index),
    );
  });

  it('supports a smaller video inference batch without changing the service maximum', async () => {
    const batches = await collectBatches(frames(33), { maxFrames: 16 });
    expect(batches.map((batch) => batch.length)).toEqual([16, 16, 1]);
  });

  it('splits requests before exceeding the conservative byte budget', async () => {
    const threeMiBBase64 = 'A'.repeat(4 * 1024 * 1024);
    readFileBase64.mockResolvedValue(threeMiBBase64);

    const batches = await collectBatches(frames(6));

    expect(batches.map((batch) => batch.length)).toEqual([5, 1]);
    for (const batch of batches) {
      const bytes = batch.reduce((sum, frame) => sum + Math.floor((frame.imageBase64?.length ?? 0) * 3 / 4), 0);
      expect(bytes).toBeLessThanOrEqual(MAX_INFERENCE_BATCH_BYTES);
    }
  });

  it('rejects an image exceeding the service per-image limit', async () => {
    readFileBase64.mockResolvedValue('A'.repeat(7 * 1024 * 1024));

    await expect(collectBatches(frames(1))).rejects.toThrow('超过推理服务单张图片上限');
  });
});

async function collectBatches(
  input: ExtractedFrame[],
  limits?: { maxFrames?: number; maxBytes?: number },
): Promise<Array<Array<{ frameIndex: number; imageBase64?: string }>>> {
  const result: Array<Array<{ frameIndex: number; imageBase64?: string }>> = [];
  for await (const batch of readFrameBatches(input, limits)) result.push(batch);
  return result;
}
