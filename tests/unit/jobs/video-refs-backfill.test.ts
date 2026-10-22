import { describe, expect, it } from 'vitest';
import { reviewedRefs, type RepairPoint, type RepairSource } from '../../../scripts/maintenance/video-refs-plan';

const plan: RepairPoint = { pointId: 'p1', contentId: 'c1', title: '逻辑填空', summary: '依据原文', evidence: [{ startMs: 19950, text: '第十天的内容' }] };
const source: RepairSource = { id: 'p1', contentId: 'c1', title: '逻辑填空', summary: '依据原文', refs: [], durationSec: 30, transcripts: [{ startMs: 19950, text: '第十天的内容' }] };
describe('reviewed video reference backfill', () => {
  it('uses exact reviewed evidence and is idempotent', () => {
    expect(reviewedRefs(plan, source)).toEqual([{ type: 'video', timestampSec: 19 }]);
    expect(reviewedRefs(plan, { ...source, refs: [{ type: 'video', timestampSec: 19 }] })).toEqual([{ type: 'video', timestampSec: 19 }]);
  });
  it('refuses changed points, unrelated sources and changed transcript excerpts', () => {
    expect(() => reviewedRefs(plan, { ...source, summary: '更新摘要' })).toThrow('STALE_POINT');
    expect(() => reviewedRefs(plan, { ...source, contentId: 'another' })).toThrow('STALE_POINT');
    expect(() => reviewedRefs(plan, { ...source, transcripts: [{ startMs: 19950, text: '其他内容' }] })).toThrow('STALE_EVIDENCE');
  });
  it('preserves existing different refs and rejects missing/out-of-range durations', () => {
    expect(() => reviewedRefs(plan, { ...source, refs: [{ type: 'video', timestampSec: 5 }] })).toThrow('EXISTING_REFS_PRESERVED');
    expect(() => reviewedRefs(plan, { ...source, durationSec: null })).toThrow('MISSING_DURATION');
    expect(() => reviewedRefs(plan, { ...source, durationSec: 19 })).toThrow('REF_OUT_OF_RANGE');
  });
});
