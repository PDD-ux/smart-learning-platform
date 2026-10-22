import { describe, expect, it } from 'vitest';

import { currentPlaybackSection, playbackSections, playbackTimeLabel, type PlaybackPoint } from '@/lib/domain/playback-notes';

function point(id: string, refs: PlaybackPoint['refs']): PlaybackPoint {
  return { pointId: id, title: id, summary: id, refs, tags: [], importance: 3 };
}

describe('playback note source anchors', () => {
  it('sorts/group anchors and drops duplicate, absent, document and invalid references without inventing times', () => {
    const sections = playbackSections([
      point('late', [{ type: 'video', timestampSec: 30 }, { type: 'video', timestampSec: 30 }]),
      point('early', [{ type: 'video', timestampSec: 10 }, { type: 'video', timestampSec: 30 }]),
      point('none', []), point('doc', [{ type: 'document', page: 1 }]),
      point('bad', [{ type: 'video', timestampSec: -1 }, { type: 'video', timestampSec: NaN }, { type: 'video', timestampSec: 61 }]),
    ], 60);
    expect(sections.map((section) => [section.timestampSec, section.points.map((item) => item.pointId)])).toEqual([[10, ['early']], [30, ['late', 'early']]]);
  });

  it('switches exactly at source times and follows backward seeks without leaking the first future point', () => {
    const sections = playbackSections([point('first', [{ type: 'video', timestampSec: 10 }]), point('second', [{ type: 'video', timestampSec: 30 }])], null);
    expect(currentPlaybackSection(sections, 9.99)).toBeNull();
    expect(currentPlaybackSection(sections, 10)?.timestampSec).toBe(10);
    expect(currentPlaybackSection(sections, 30)?.timestampSec).toBe(30);
    expect(currentPlaybackSection(sections, 12)?.timestampSec).toBe(10);
    expect(currentPlaybackSection([], 20)).toBeNull();
    expect(currentPlaybackSection(sections, NaN)).toBeNull();
    expect(playbackTimeLabel(2760.083)).toBe('46:00');
  });
});
