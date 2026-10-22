import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
type Worklet = { port: { onmessage: (event: { data: string }) => void }; process: (input: Float32Array[][]) => boolean };
function harness(): { worklet: Worklet; chunks: Int16Array[] } {
  let processor: (new () => Worklet) | null = null;
  const chunks: Int16Array[] = [];
  class Base { port = { onmessage: (_event: { data: string }): void => undefined, postMessage: (data: { type: string; samples?: Int16Array }): void => { if (data.samples) chunks.push(data.samples); } }; }
  runInNewContext(readFileSync('public/audio/live-pcm-worklet.js', 'utf8'), { AudioWorkletProcessor: Base, sampleRate: 48000, Int16Array, registerProcessor: (_name: string, value: new () => Worklet): void => { processor = value; } });
  if (!processor) throw new Error('Worklet not registered');
  return { worklet: new (processor as new () => Worklet)(), chunks };
}
describe('live microphone worklet without microphone access', () => {
  it('does not capture before explicit resume and resamples five seconds into 16k PCM', (): void => {
    const { worklet, chunks } = harness(); const audio = new Float32Array(240000).fill(0.5);
    worklet.process([[audio]]); expect(chunks).toHaveLength(0);
    worklet.port.onmessage({ data: 'resume' }); worklet.process([[audio]]);
    expect(chunks).toHaveLength(1); expect(chunks[0]).toHaveLength(80000); expect(chunks[0][0]).toBe(16384);
  });
  it('flushes tail, pads only sub-100ms fragments and stays paused', (): void => {
    const { worklet, chunks } = harness(); worklet.port.onmessage({ data: 'resume' });
    worklet.process([[new Float32Array(480).fill(1)]]); worklet.port.onmessage({ data: 'pause' });
    expect(chunks[0]).toHaveLength(1600); expect(chunks[0][0]).toBe(32767); expect(chunks[0][200]).toBe(0);
    worklet.process([[new Float32Array(240000)]]); expect(chunks).toHaveLength(1);
    worklet.port.onmessage({ data: 'resume' }); worklet.process([[new Float32Array(48000)]]); worklet.port.onmessage({ data: 'stop' });
    expect(chunks[1]).toHaveLength(16000);
  });
});
