import { describe, expect, it } from 'vitest';

import { shanghaiDayRange } from '@/lib/domain/admin-overview';

describe('shanghaiDayRange', () => {
  it('uses the Shanghai calendar day immediately before the UTC date rolls over', () => {
    const range = shanghaiDayRange(new Date('2026-10-09T15:59:59.999Z'));
    expect(range.date).toBe('2026-10-09');
    expect(range.start.toISOString()).toBe('2026-10-08T16:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-09T16:00:00.000Z');
  });

  it('moves to the next Shanghai day at 16:00 UTC', () => {
    const range = shanghaiDayRange(new Date('2026-10-09T16:00:00.000Z'));
    expect(range.date).toBe('2026-10-10');
    expect(range.start.toISOString()).toBe('2026-10-09T16:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-10T16:00:00.000Z');
  });
});
