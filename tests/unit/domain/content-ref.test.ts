import { describe, expect, it } from 'vitest';

import {
  contentRefSchema,
  isDocumentRef,
  isRefInRange,
  isVideoRef,
  refSortKey,
  refTypeMatches,
} from '@/lib/domain/content-ref';

describe('ContentRef schemas and range helpers', () => {
  it('accepts valid video and document references', () => {
    const video = contentRefSchema.safeParse({ type: 'video', timestampSec: 12 });
    const document = contentRefSchema.safeParse({ type: 'document', page: 3, blockIndex: 1 });

    expect(video.success).toBe(true);
    expect(document.success).toBe(true);
    if (video.success) expect(isVideoRef(video.data)).toBe(true);
    if (document.success) expect(isDocumentRef(document.data)).toBe(true);
  });

  it('rejects invalid discriminated references and ranges', () => {
    expect(contentRefSchema.safeParse({ type: 'video', timestampSec: -1 }).success).toBe(false);
    expect(contentRefSchema.safeParse({ type: 'video', timestampSec: 1.5 }).success).toBe(false);
    expect(contentRefSchema.safeParse({ type: 'document', page: 0 }).success).toBe(false);
    expect(contentRefSchema.safeParse({ type: 'document', page: 2, blockIndex: -1 }).success).toBe(false);
    expect(contentRefSchema.safeParse({ type: 'audio', timestampSec: 2 }).success).toBe(false);
  });

  it('checks video and document boundaries inclusively', () => {
    const video = { type: 'video' as const, timestampSec: 60 };
    const document = { type: 'document' as const, page: 4 };

    expect(isRefInRange(video, { durationSec: 60 })).toBe(true);
    expect(isRefInRange(video, { durationSec: 59 })).toBe(false);
    expect(isRefInRange(video, { durationSec: null })).toBe(false);
    expect(isRefInRange(document, { pageCount: 4 })).toBe(true);
    expect(isRefInRange(document, { pageCount: 3 })).toBe(false);
    expect(isRefInRange(document, {})).toBe(false);
  });

  it('sorts by timestamp or page and matches the content type', () => {
    expect(refSortKey({ type: 'video', timestampSec: 25 })).toBe(25);
    expect(refSortKey({ type: 'document', page: 7 })).toBe(7);
    expect(refTypeMatches({ type: 'video', timestampSec: 1 }, 'video')).toBe(true);
    expect(refTypeMatches({ type: 'video', timestampSec: 1 }, 'document')).toBe(false);
    expect(refTypeMatches({ type: 'document', page: 1 }, 'document')).toBe(true);
  });
});
