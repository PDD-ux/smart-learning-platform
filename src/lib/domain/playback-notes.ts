import type { Understanding } from '@/services/api';

export type PlaybackPoint = Understanding['knowledgePoints'][number];
export type PlaybackSection = { timestampSec: number; points: PlaybackPoint[] };

/** Only use explicit source anchors; a display interval is not a semantic boundary. */
export function playbackSections(points: PlaybackPoint[], durationSec: number | null): PlaybackSection[] {
  const byTime = new Map<number, PlaybackPoint[]>();
  for (const point of points) {
    const seen = new Set<number>();
    for (const ref of point.refs) {
      if (ref.type !== 'video' || !Number.isFinite(ref.timestampSec) || ref.timestampSec < 0
        || (durationSec !== null && ref.timestampSec > durationSec) || seen.has(ref.timestampSec)) continue;
      seen.add(ref.timestampSec);
      const group = byTime.get(ref.timestampSec) ?? [];
      group.push(point);
      byTime.set(ref.timestampSec, group);
    }
  }
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([timestampSec, group]) => ({ timestampSec, points: group }));
}

export function currentPlaybackSection(sections: PlaybackSection[], positionSec: number): PlaybackSection | null {
  if (!Number.isFinite(positionSec) || positionSec < 0) return null;
  let low = 0;
  let high = sections.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (sections[mid].timestampSec <= positionSec) { found = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return found < 0 ? null : sections[found];
}

export function playbackTimeLabel(positionSec: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(positionSec) ? positionSec : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
