import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const runTextMock = vi.hoisted(() => vi.fn());
const runBufferMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/media/ffmpeg-runner', () => ({ runText: runTextMock, runBuffer: runBufferMock }));

import { extractAudioChunks, extractFrameChunks } from '@/lib/media/ffmpeg';

const directories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function mockFfmpegOutput(): void {
  runTextMock.mockImplementation(async (_bin: string, args: string[], _timeoutMs: number) => {
    const output = args.at(-1);
    if (!output) throw new Error('missing output path');

    if (output.endsWith('.jpg')) {
      const timeIndex = args.indexOf('-t');
      const vfIndex = args.indexOf('-vf');
      const duration = Number(args[timeIndex + 1]);
      const interval = Number((args[vfIndex + 1] ?? '').split('/')[1]);
      const count = Math.ceil(duration / interval);
      const directory = path.dirname(output);
      await Promise.all(Array.from({ length: count }, (_, index) =>
        writeFile(path.join(directory, `frame_${String(index + 1).padStart(5, '0')}.jpg`), 'jpeg-fixture'),
      ));
    } else {
      await writeFile(output, 'wav-fixture');
    }
    return '';
  });
}

describe('long-video ffmpeg chunks', () => {
  it('keeps global frame indices and timestamps continuous across windows', async () => {
    mockFfmpegOutput();
    const directory = await mkdtemp(path.join(tmpdir(), 'slp-ffmpeg-frame-chunks-'));
    directories.push(directory);

    const chunks = [];
    for await (const chunk of extractFrameChunks('video.mkv', 2, directory, 10, 4)) {
      chunks.push({ startSec: chunk.startSec, frames: chunk.frames });
      await rm(chunk.directory, { recursive: true, force: true });
    }

    expect(chunks.map((chunk) => chunk.startSec)).toEqual([0, 4, 8]);
    expect(chunks.flatMap((chunk) => chunk.frames.map((frame) => frame.frameIndex))).toEqual([0, 1, 2, 3, 4]);
    expect(chunks.flatMap((chunk) => chunk.frames.map((frame) => frame.timestampMs))).toEqual([
      0, 2_000, 4_000, 6_000, 8_000,
    ]);
    expect(runTextMock.mock.calls.map((call) => (call[1] as string[]).slice(0, 8))).toEqual([
      ['-v', 'error', '-y', '-ss', '0', '-i', 'video.mkv', '-t'],
      ['-v', 'error', '-y', '-ss', '4', '-i', 'video.mkv', '-t'],
      ['-v', 'error', '-y', '-ss', '8', '-i', 'video.mkv', '-t'],
    ]);
    expect(runTextMock.mock.calls.every((call) => call[2] === 120_000)).toBe(true);
  });

  it('emits bounded audio files with global time offsets', async () => {
    mockFfmpegOutput();
    const directory = await mkdtemp(path.join(tmpdir(), 'slp-ffmpeg-audio-chunks-'));
    directories.push(directory);

    const chunks = [];
    for await (const chunk of extractAudioChunks('video.mkv', directory, 9, 4)) {
      chunks.push({ startSec: chunk.startSec, durationSec: chunk.durationSec, audioPath: chunk.audioPath });
      expect(await readFile(chunk.audioPath, 'utf8')).toBe('wav-fixture');
      await rm(chunk.directory, { recursive: true, force: true });
    }

    expect(chunks.map(({ startSec, durationSec }) => [startSec, durationSec])).toEqual([
      [0, 4], [4, 4], [8, 1],
    ]);
  });

  it('rejects invalid windows instead of entering a non-progressing loop', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'slp-ffmpeg-invalid-window-'));
    directories.push(directory);

    await expect(async () => {
      for await (const _chunk of extractFrameChunks('video.mkv', 5, directory, 10, 4)) {
        // no-op
      }
    }).rejects.toThrow('分段时长必须至少覆盖一个抽帧间隔');
    expect(runTextMock).not.toHaveBeenCalled();
  });
});
