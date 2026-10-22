import { describe, expect, it } from 'vitest';
import { selectQaSources } from '@/lib/domain/qa-sources';
describe('selectQaSources', () => {
  it('keeps split speech nearby but does not bridge a truncated time gap', () => {
    const sources = [293, 300, 301, 303, 1481].map((timestampSec, index) => ({ ref: { type: 'video' as const, timestampSec }, text: ['可再生能源发电因天气不同', '不同存在', '不同时间尺度的', '间歇性', '反面论证'][index] }));
    expect(selectQaSources(sources, '为什么可再生能源发电具有波动性？')).toEqual(sources.slice(0, 4));
    expect(selectQaSources(sources, '总结资料')).toEqual(sources);
  });
  it('does not mix document pages when locating a specific topic', () => {
    const sources = [1, 2].map((page) => ({ ref: { type: 'document' as const, page }, text: page === 1 ? '梯度下降沿负梯度更新参数' : '不同页的其他概念' }));
    expect(selectQaSources(sources, '梯度下降如何更新参数？')).toEqual([sources[0]]);
  });
});
