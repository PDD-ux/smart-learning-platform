import { describe, expect, it } from 'vitest';
import { groundQaCitations } from '@/lib/domain/qa-citations';

describe('groundQaCitations', () => {
  const video = { contentType: 'video' as const, durationSec: 600, pageCount: null };
  it('preserves exact excerpts but repairs model repetition without altering repeated source text', () => {
    const ref = { type: 'video' as const, timestampSec: 293 };
    const text = '天气不同，时间尺度不同。';
    expect(groundQaCitations([{ ref, excerpt: '时间尺度不同。' }, { ref, excerpt: text + text }], [{ ref, text }], video))
      .toEqual([{ ref, excerpt: '时间尺度不同。' }, { ref, excerpt: text }]);
    expect(groundQaCitations([{ ref, excerpt: '重复重复重复重复' }], [{ ref, text: '重复重复' }], video)[0].excerpt).toBe('重复重复');
    expect(groundQaCitations([{ ref, excerpt: '完全无关' }], [{ ref, text }], video)).toEqual([]);
  });
  it('rejects unknown, wrong-type and out-of-range sources, and deduplicates repaired excerpts', () => {
    const ref = { type: 'video' as const, timestampSec: 0 };
    const sources = [{ ref, text: '开场' }, { ref: { type: 'video' as const, timestampSec: 601 }, text: '越界' }];
    expect(groundQaCitations([
      { ref, excerpt: '开场开场一' }, { ref, excerpt: '开场开场二' },
      { ref: { type: 'video', timestampSec: 100 }, excerpt: '开场' },
      { ref: { type: 'video', timestampSec: 601 }, excerpt: '越界' },
      { ref: { type: 'document', page: 1 }, excerpt: '开场' },
    ], sources, video)).toEqual([{ ref, excerpt: '开场' }]);
  });
  it('resolves a unique document block without mixing pages or accepting ambiguous matches', () => {
    const sources = [
      { ref: { type: 'document' as const, page: 2, blockIndex: 0 }, text: '共同内容，第一块' },
      { ref: { type: 'document' as const, page: 2, blockIndex: 1 }, text: '共同内容，第二块' },
    ];
    const bounds = { contentType: 'document' as const, durationSec: null, pageCount: 2 };
    expect(groundQaCitations([
      { ref: { type: 'document', page: 2 }, excerpt: '第二块' },
      { ref: { type: 'document', page: 2 }, excerpt: '共同内容' },
      { ref: { type: 'document', page: 1 }, excerpt: '第二块' },
      { ref: { type: 'document', page: 2, blockIndex: 8 }, excerpt: '第二块' },
    ], sources, bounds)).toEqual([{ ref: sources[1].ref, excerpt: '第二块' }]);
  });
  it('caps fallback quotes at 500 characters and never supplies a citation when evidence is absent', () => {
    const ref = { type: 'video' as const, timestampSec: 0 };
    expect(groundQaCitations([{ ref, excerpt: '原'.repeat(12) + '拼接' }], [{ ref, text: '原'.repeat(800) }], video)[0].excerpt).toHaveLength(500);
    expect(groundQaCitations([{ ref, excerpt: '原文' }], [], video)).toEqual([]);
  });
  it('corrects a neighbouring timestamp only from uniquely identifiable original text', () => {
    const ref = { type: 'video' as const, timestampSec: 293 };
    const text = '可再生能源发电具有间歇性。';
    expect(groundQaCitations([{ ref: { type: 'video', timestampSec: 287 }, excerpt: text + text }], [{ ref, text }], video))
      .toEqual([{ ref, excerpt: text }]);
    expect(groundQaCitations([{ ref: { type: 'video', timestampSec: 287 }, excerpt: text }], [{ ref, text }, { ref: { type: 'video', timestampSec: 300 }, text }], video)).toEqual([]);
  });
});
