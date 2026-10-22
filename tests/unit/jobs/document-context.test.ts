import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentContexts, documentModelProvider } from '@/lib/jobs/pipeline/document-context';
import type { StructuredContext } from '@/lib/jobs/pipeline/context-builder';

function context(texts: string[]): StructuredContext {
  const sourceSegments = texts.map((text, index) => ({ text, ref: { type: 'document' as const, page: index + 1, blockIndex: 0 } }));
  return { text: texts.join('\n'), sourceSegments, sourceRefs: sourceSegments.map((source) => source.ref),
    stats: { transcriptCount: 0, textBlockCount: texts.length, noteCount: 1 }, noteTexts: ['私人笔记'], truncated: false };
}

describe('document contexts', (): void => {
  afterEach((): void => { vi.unstubAllEnvs(); });
  it('keeps all 222 pages in order with bounded batches and no personal notes', (): void => {
    const input = context(Array.from({ length: 222 }, (_, index): string => `第${index + 1}页正文`));
    const batches = documentContexts(input, 222);
    expect(batches).toHaveLength(19);
    expect(batches.flatMap((batch) => batch.sourceSegments)).toEqual(input.sourceSegments);
    for (const batch of batches) {
      expect(batch.text.length).toBeLessThanOrEqual(7011);
      expect(new Set(batch.sourceRefs.map((ref) => ref.type === 'document' ? ref.page : 0)).size).toBeLessThanOrEqual(12);
      expect(batch.noteTexts).toEqual([]);
      expect(batch.truncated).toBe(false);
    }
  });
  it('preserves every character of an oversized page and its original block reference', (): void => {
    const input = context(['甲'.repeat(17_003), '中间', '结尾']);
    const batches = documentContexts(input, 3);
    expect(batches).toHaveLength(3);
    expect(batches.flatMap((batch) => batch.sourceSegments).filter((source) => source.ref.type === 'document' && source.ref.page === 1)
      .map((source) => source.text).join('')).toBe(input.sourceSegments[0].text);
    expect(batches.flatMap((batch) => batch.sourceRefs).every((ref) => ref.type === 'document' && ref.blockIndex === 0)).toBe(true);
  });
  it('sorts real pages/blocks and skips genuinely blank text', (): void => {
    const input = context(['一', ' ', '三']);
    input.sourceSegments.reverse();
    expect(documentContexts(input, 3)[0].sourceRefs).toEqual([{ type: 'document', page: 1, blockIndex: 0 }, { type: 'document', page: 3, blockIndex: 0 }]);
  });
  it('does not split a unicode surrogate pair at the character budget boundary', (): void => {
    const text = '字'.repeat(6_999) + '😀' + '后文';
    const segments = documentContexts(context([text]), 1).flatMap((batch) => batch.sourceSegments);
    expect(segments.map((source) => source.text).join('')).toBe(text);
    expect(segments[0].text.endsWith('字')).toBe(true);
    expect(segments[1].text.startsWith('😀')).toBe(true);
  });
  it('rejects excessive size, missing metadata, invalid page and already truncated sources', (): void => {
    expect(() => documentContexts(context(['字'.repeat(7_000 * 48 + 1)]), 1)).toThrow('48批');
    expect(() => documentContexts(context(['一', '二']), 1)).toThrow('页码');
    expect(() => documentContexts({ ...context(['一']), truncated: true }, 1)).toThrow('截断');
    expect(() => documentContexts({ ...context(['一']), sourceSegments: [] }, 1)).toThrow('缺少有效来源');
  });
  it('uses an explicit provider and rejects unknown config without fallback', (): void => {
    vi.stubEnv('LLM_PROVIDER', ''); expect(documentModelProvider()).toBe('spark');
    vi.stubEnv('LLM_PROVIDER', 'spark'); expect(documentModelProvider()).toBe('spark');
    vi.stubEnv('LLM_PROVIDER', 'unknown'); expect(() => documentModelProvider()).toThrow('LLM_PROVIDER仅支持spark');
  });
});
