import { z } from 'zod';

export const chunkInput = z.object({ sequence: z.number().int().min(0).max(3600), pcmBase64: z.string().min(4268).max(213336).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().refine((value): boolean => {
  const bytes = value.pcmBase64.length / 4 * 3 - (value.pcmBase64.endsWith('==') ? 2 : value.pcmBase64.endsWith('=') ? 1 : 0);
  return value.pcmBase64.length % 4 === 0 && bytes >= 3200 && bytes <= 160000 && bytes % 2 === 0;
}, '音频分片长度无效');
export type LiveHighlight = { title: string; sourceSequences: number[]; quotes: string[]; startMs: number };
export type LiveChunkDto = { sequence: number; startMs: number; endMs: number; state: string; text: string; reason: string | null };
export type LiveSessionDto = { id: string; title: string; state: string; nextSequence: number; totalSamples: number; processingSequence: number | null; lastHighlightSequence: number; highlightVersion: number; highlights: LiveHighlight[]; summaryMarkdown: string | null; createdAt: string; chunks: LiveChunkDto[] };
export function timestamp(ms: number): string { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export function pcmWave(pcm: Buffer): Buffer {
  if (pcm.length < 3200 || pcm.length > 160000 || pcm.length % 2) throw new Error('音频分片必须为100毫秒至5秒的PCM16单声道');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function finalLiveMarkdown(title: string, chunks: LiveChunkDto[], highlights: LiveHighlight[]): string {
  return [`# ${title}`, '', '> 本地语音转写与辅助重点，请结合实际录音内容核对。原始音频未长期保存。', '', '## 滚动重点（AI辅助，待核对）',
    ...highlights.flatMap((point): string[] => [`### ${timestamp(point.startMs)} ${point.title}`, ...point.quotes.map((quote): string => `> ${quote}`), '']),
    ...(highlights.length ? [] : ['尚未生成可用AI重点，以下保留完整转写。']), '', '## 完整转写',
    ...chunks.filter((chunk): boolean => chunk.state === 'DONE').map((chunk): string => `${timestamp(chunk.startMs)}—${timestamp(chunk.endMs)}  ${chunk.text || '（此片段未识别到语音）'}`),
  ].join('\n');
}
