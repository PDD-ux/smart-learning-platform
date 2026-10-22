import { describe, expect, it } from 'vitest';
import { chunkInput, pcmWave, timestamp, finalLiveMarkdown } from '@/lib/domain/live-notes';
describe('live note audio and complete transcript', () => {
  it.each([3200, 160000])('writes valid PCM RIFF data for %s bytes', (length): void => {
    const wave = pcmWave(Buffer.alloc(length));
    expect(wave.toString('ascii', 0, 4)).toBe('RIFF'); expect(wave.readUInt32LE(24)).toBe(16000);
    expect(wave.readUInt16LE(22)).toBe(1); expect(wave.readUInt32LE(40)).toBe(length); expect(wave.length).toBe(length + 44);
  });
  it.each([0, 3198, 3201, 160002])('rejects an invalid PCM size %s', (length): void => { expect(() => pcmWave(Buffer.alloc(length))).toThrow(); });
  it('rejects unbounded or noncanonical request shapes', (): void => {
    expect(chunkInput.safeParse({ sequence: 0, pcmBase64: Buffer.alloc(3200).toString('base64') }).success).toBe(true);
    expect(chunkInput.safeParse({ sequence: -1, pcmBase64: 'x' }).success).toBe(false);
    expect(chunkInput.safeParse({ sequence: 0, pcmBase64: '%'.repeat(5000) }).success).toBe(false);
    expect(chunkInput.safeParse({ sequence: 0, pcmBase64: Buffer.alloc(160002).toString('base64') }).success).toBe(false);
  });
  it('keeps middle and last transcript entries even without AI points', (): void => {
    const note = finalLiveMarkdown('课堂', Array.from({ length: 20 }, (_, sequence) => ({ sequence, startMs: sequence * 5000, endMs: (sequence + 1) * 5000, text: `原文${sequence}`, state: 'DONE', reason: null })), []);
    expect(note).toContain('原文0'); expect(note).toContain('原文10'); expect(note).toContain('原文19'); expect(note).toContain('尚未生成可用AI重点');
    expect(timestamp(65000)).toBe('1:05');
  });
});
