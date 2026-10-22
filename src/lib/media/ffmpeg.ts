import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { runBuffer, runText } from '@/lib/media/ffmpeg-runner';

/**
 * ffprobe / ffmpeg 封装（tasks.md §3.2）
 * ------------------------------------------------------------
 * 仅用 child_process 直接调用二进制，不引入额外依赖。
 * 二进制路径可通过 FFPROBE_PATH / FFMPEG_PATH 覆盖（便携版/自定义安装）。
 * 环境无 ffmpeg 时，worker 走降级（见 content-parse.worker.ts）。
 */

export type VideoProbe = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
};

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH?.trim() || 'ffprobe';
}

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

/** 检测 ffprobe 是否可用（缺失/不可执行 → false） */
export async function isFfprobeAvailable(): Promise<boolean> {
  try {
    await runText(ffprobePath(), ['-version'], 5_000);
    return true;
  } catch {
    return false;
  }
}

type FfprobeJson = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
  }>;
};

/** 读取视频时长 / 分辨率 / 编码（失败抛出，由调用方决定降级） */
export async function probeVideo(filePath: string): Promise<VideoProbe> {
  const stdout = await runText(
    ffprobePath(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    30_000,
  );
  const data = JSON.parse(stdout) as FfprobeJson;
  const videoStream = data.streams?.find((s) => s.codec_type === 'video');
  const rawDuration = Number(data.format?.duration ?? videoStream?.duration);
  return {
    durationSec: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    codec: videoStream?.codec_name ?? null,
  };
}

/** 抽取指定时刻的一帧作为封面（JPEG Buffer） */
export async function extractCover(filePath: string, atSec: number): Promise<Buffer> {
  return runBuffer(
    ffmpegPath(),
    [
      '-v',
      'error',
      '-ss',
      String(Math.max(0, atSec)),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ],
    30_000,
  );
}

// ---------------------------------------------------------------------------
// 关键帧 / 音轨抽取（tasks.md §6.3 阶段 A）
// ---------------------------------------------------------------------------

export type ExtractedFrame = {
  frameIndex: number;
  timestampMs: number;
  filePath: string;
};

export type ExtractedFrameChunk = {
  chunkIndex: number;
  startSec: number;
  durationSec: number;
  directory: string;
  frames: ExtractedFrame[];
};

export type ExtractedAudioChunk = {
  chunkIndex: number;
  startSec: number;
  durationSec: number;
  directory: string;
  audioPath: string;
};

const VIDEO_CHUNK_DURATION_SEC = 5 * 60;
const FFMPEG_CHUNK_TIMEOUT_MS = 120_000;

async function resolveDuration(filePath: string, durationSec?: number | null): Promise<number> {
  if (durationSec != null && Number.isFinite(durationSec) && durationSec > 0) return durationSec;
  const probe = await probeVideo(filePath);
  if (probe.durationSec == null) throw new Error('无法获取视频时长，不能安全地分段处理');
  return probe.durationSec;
}

/** 检测 ffmpeg 是否可用（抽帧/抽音轨前置） */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await runText(ffmpegPath(), ['-version'], 5_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * 按固定间隔抽帧（默认每 2s 1 帧），落 `outDir/frame_%05d.jpg`
 * @returns 按时间升序的帧清单
 */
export async function extractFrames(
  filePath: string,
  intervalSec: number,
  outDir: string,
): Promise<ExtractedFrame[]> {
  const frames: ExtractedFrame[] = [];
  for await (const chunk of extractFrameChunks(filePath, intervalSec, outDir)) {
    frames.push(...chunk.frames);
  }
  return frames;
}

/**
 * Extract at most five minutes of frames at a time. The caller should consume
 * and remove each chunk before requesting the next one.
 */
export async function* extractFrameChunks(
  filePath: string,
  intervalSec: number,
  outDir: string,
  durationSec?: number | null,
  chunkDurationSec = VIDEO_CHUNK_DURATION_SEC,
): AsyncGenerator<ExtractedFrameChunk> {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    throw new Error('抽帧间隔必须是正数');
  }
  const duration = await resolveDuration(filePath, durationSec);
  const alignedChunkDuration = Math.floor(chunkDurationSec / intervalSec) * intervalSec;
  if (!Number.isFinite(alignedChunkDuration) || alignedChunkDuration < intervalSec) {
    throw new Error('分段时长必须至少覆盖一个抽帧间隔');
  }

  await mkdir(outDir, { recursive: true });
  let chunkIndex = 0;
  for (let startSec = 0; startSec < duration; startSec += alignedChunkDuration) {
    const currentDurationSec = Math.min(alignedChunkDuration, duration - startSec);
    const directory = path.join(outDir, `frames-${String(chunkIndex).padStart(5, '0')}`);
    await mkdir(directory, { recursive: true });
    const pattern = path.join(directory, 'frame_%05d.jpg');

    try {
      await runText(
        ffmpegPath(),
        [
          '-v', 'error', '-y', '-ss', String(startSec), '-i', filePath,
          '-t', String(currentDurationSec), '-vf', `fps=1/${intervalSec}`,
          '-q:v', '2', pattern,
        ],
        FFMPEG_CHUNK_TIMEOUT_MS,
      );
      const files = (await readdir(directory)).filter((file) => file.endsWith('.jpg')).sort();
      const firstFrameIndex = Math.round(startSec / intervalSec);
      const frames = files.map((file, index) => {
        const frameIndex = firstFrameIndex + index;
        return {
          frameIndex,
          timestampMs: Math.round(frameIndex * intervalSec * 1_000),
          filePath: path.join(directory, file),
        };
      });

      yield { chunkIndex, startSec, durationSec: currentDurationSec, directory, frames };
      chunkIndex += 1;
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
}

/** Extract bounded WAV chunks for ASR, preserving each chunk's global offset. */
export async function* extractAudioChunks(
  filePath: string,
  outDir: string,
  durationSec?: number | null,
  chunkDurationSec = VIDEO_CHUNK_DURATION_SEC,
): AsyncGenerator<ExtractedAudioChunk> {
  if (!Number.isFinite(chunkDurationSec) || chunkDurationSec <= 0) {
    throw new Error('音频分段时长必须是正数');
  }
  const duration = await resolveDuration(filePath, durationSec);
  await mkdir(outDir, { recursive: true });

  let chunkIndex = 0;
  for (let startSec = 0; startSec < duration; startSec += chunkDurationSec) {
    const currentDurationSec = Math.min(chunkDurationSec, duration - startSec);
    const directory = path.join(outDir, `audio-${String(chunkIndex).padStart(5, '0')}`);
    await mkdir(directory, { recursive: true });
    const audioPath = path.join(directory, 'audio.wav');
    try {
      await runText(
        ffmpegPath(),
        [
          '-v', 'error', '-y', '-ss', String(startSec), '-i', filePath,
          '-t', String(currentDurationSec), '-vn', '-ac', '1', '-ar', '16000', audioPath,
        ],
        FFMPEG_CHUNK_TIMEOUT_MS,
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    yield { chunkIndex, startSec, durationSec: currentDurationSec, directory, audioPath };
    chunkIndex += 1;
  }
}

/** 抽取单声道 16k 音轨（wav），供 ASR 转写 */
export async function extractAudio(filePath: string, outPath: string): Promise<string> {
  await runText(
    ffmpegPath(),
    ['-v', 'error', '-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', outPath],
    120_000,
  );
  return outPath;
}
