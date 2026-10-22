import { describe, expect, it } from 'vitest';
import { resolveStudyLocation, studyCitationUrl } from '@/lib/domain/study-location';

describe('study citation navigation', () => {
  const video = { contentType: 'video' as const, durationSec: 120, pageCount: null };
  const document = { contentType: 'document' as const, durationSec: null, pageCount: 3 };
  it('carries both citation types and accepts zero/end video positions', () => {
    expect(studyCitationUrl('lesson', { type: 'video', timestampSec: 62 })).toBe('/study/lesson?t=62');
    expect(studyCitationUrl('lesson', { type: 'document', page: 2 })).toBe('/study/lesson?page=2');
    expect(resolveStudyLocation({ t: '0' }, video)).toEqual({ type: 'video', timestampSec: 0 });
    expect(resolveStudyLocation({ t: '120' }, video)).toEqual({ type: 'video', timestampSec: 120 });
    expect(resolveStudyLocation({ page: '3' }, document)).toEqual({ type: 'document', page: 3 });
  });
  it('rejects malformed, duplicated, wrong-type and out-of-bounds anchors', () => {
    for (const t of ['', '-1', '1.5', 'Infinity', '121', '9007199254740993', ['62', '63']]) expect(resolveStudyLocation({ t }, video)).toBeNull();
    expect(resolveStudyLocation({ page: '2' }, video)).toBeNull();
    expect(resolveStudyLocation({ t: '2' }, document)).toBeNull();
    expect(resolveStudyLocation({ page: '0' }, document)).toBeNull();
    expect(resolveStudyLocation({ page: '4' }, document)).toBeNull();
    expect(resolveStudyLocation({ t: '10' }, { ...video, durationSec: null })).toBeNull();
  });
});
