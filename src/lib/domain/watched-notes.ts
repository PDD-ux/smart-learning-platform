import type { Understanding } from '@/services/api';

export type WatchedSource = Understanding['transcriptSegments'][number];
export type WatchedNote = { markdown: string; sources: Array<{ segmentId: string; startMs: number; endMs: number; text: string }>; generatedAt: string; mode?: 'source-extract' };

/** Only complete segments inside the continuously watched range are eligible. */
export function watchedSources(segments: WatchedSource[], startSec: number, endSec: number, processed: Set<string>): WatchedSource[] {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return [];
  let characters = 0;
  const selected: WatchedSource[] = [];
  for (const segment of [...segments].sort((a, b): number => a.startMs - b.startMs)) {
    if (processed.has(segment.segmentId) || segment.startMs < startSec * 1000 || segment.endMs > endSec * 1000
      || segment.startMs < 0 || segment.endMs <= segment.startMs || !segment.text.trim()) continue;
    if (selected.length === 12 || characters + segment.text.length > 6000) break;
    selected.push(segment); characters += segment.text.length;
  }
  return selected;
}
