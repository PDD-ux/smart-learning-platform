import { describe, it, expect } from 'vitest';
import { watchedSources, type WatchedSource } from '@/lib/domain/watched-notes';

function source(id: string, startMs: number, endMs: number, text = '真实课堂转写'): WatchedSource { return { segmentId: id, seq: 0, startMs, endMs, text }; }
describe('watched sources', (): void => {
  it('includes only complete sources inside watched range, not current unfinished or skipped speech', (): void => {
    const result = watchedSources([source('before', 0, 9000), source('complete', 10000, 20000), source('future', 20000, 40000), source('after', 50000, 60000)], 10, 30, new Set());
    expect(result.map((item): string => item.segmentId)).toEqual(['complete']);
  });
  it('does not repeat processed sources or include invalid intervals', (): void => {
    expect(watchedSources([source('done', 0, 1000), source('bad', 4000, 3000), source('empty', 1000, 2000, '')], 0, 30, new Set(['done']))).toEqual([]);
  });
  it('bounds both source count and characters without cutting up speech', (): void => {
    expect(watchedSources(Array.from({ length: 20 }, (_, n): WatchedSource => source(String(n), n * 1000, n * 1000 + 500)), 0, 30, new Set())).toHaveLength(12);
    expect(watchedSources([source('a', 0, 1000, '字'.repeat(5000)), source('b', 2000, 3000, '字'.repeat(2000))], 0, 30, new Set())).toHaveLength(1);
  });
});
