import { describe, expect, it } from 'vitest';

import {
  toKnowledgePointDto,
  toTextBlockDto,
  toTranscriptSegmentDto,
} from '@/lib/domain/understanding-mapper';

/**
 * 理解产物映射 单测（tasks.md §6.5）
 */

describe('understanding-mapper', () => {
  it('maps a transcript segment', () => {
    expect(
      toTranscriptSegmentDto({
        id: 's1',
        contentId: 'c1',
        seq: 2,
        startMs: 0,
        endMs: 6000,
        text: 'hello',
      }),
    ).toEqual({ segmentId: 's1', seq: 2, startMs: 0, endMs: 6000, text: 'hello' });
  });

  it('maps text block sources to dto labels (frame → ocr)', () => {
    const base = { id: 'b1', contentId: 'c1', sequence: 0, text: 'x' };
    expect(
      toTextBlockDto({ ...base, source: 'PDF', ref: { type: 'document', page: 1 } } as never).source,
    ).toBe('pdf');
    expect(
      toTextBlockDto({ ...base, source: 'FRAME', ref: { type: 'video', timestampSec: 3 } } as never)
        .source,
    ).toBe('ocr');
  });

  it('maps knowledge points and tolerates malformed refs', () => {
    const dto = toKnowledgePointDto({
      id: 'p1',
      contentId: 'c1',
      ownerId: 'u1',
      title: 'T',
      summary: 'S',
      tags: ['a'],
      importance: 4,
      refs: [{ type: 'video', timestampSec: 5 }],
      createdAt: new Date(),
    } as never);
    expect(dto).toMatchObject({ pointId: 'p1', title: 'T', refs: [{ type: 'video', timestampSec: 5 }] });

    const bad = toKnowledgePointDto({
      id: 'p2',
      contentId: 'c1',
      ownerId: 'u1',
      title: 'T',
      summary: 'S',
      tags: [],
      importance: 1,
      refs: 'not-an-array',
      createdAt: new Date(),
    } as never);
    expect(bad.refs).toEqual([]);
  });
});
