import { describe, expect, it } from 'vitest';

import { buildGraphPointDetails } from '@/lib/domain/graph-details';

describe('buildGraphPointDetails', () => {
  it('counts notes anchored to point references and flashcards with latest review date', () => {
    const details = buildGraphPointDetails(
      [
        { id: 'p1', contentId: 'c1', refs: [{ type: 'video', timestampSec: 12 }, { type: 'document', page: 3 }] },
        { id: 'p2', contentId: 'c1', refs: [{ type: 'video', timestampSec: 99 }] },
      ],
      [
        { contentId: 'c1', ref: { type: 'video', timestampSec: 12 } },
        { contentId: 'c1', ref: { type: 'video', timestampSec: 12 } },
        { contentId: 'c1', ref: { type: 'document', page: 3 } },
        { contentId: 'c1', ref: { type: 'video', timestampSec: 50 } },
      ],
      [
        { pointId: 'p1', reviewLogs: [{ reviewedAt: new Date('2026-10-01T10:00:00.000Z') }] },
        { pointId: 'p1', reviewLogs: [{ reviewedAt: new Date('2026-10-02T10:00:00.000Z') }] },
        { pointId: 'p2', reviewLogs: [] },
      ],
    );

    expect(details.get('p1')).toEqual({
      relatedNoteCount: 3,
      relatedFlashcardCount: 2,
      lastReviewedAt: '2026-10-02T10:00:00.000Z',
    });
    expect(details.get('p2')).toEqual({
      relatedNoteCount: 0,
      relatedFlashcardCount: 1,
      lastReviewedAt: null,
    });
  });
});
