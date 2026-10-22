import { describe, expect, it } from 'vitest';
import { watchedExtractSchema, watchedExtractMarkdown, type ExtractSource } from '@/lib/domain/watched-note-extract';

const sources: ExtractSource[] = [
  { startMs: 1000, endMs: 2000, text: '低成本大规模的储能系统可以突破可再生能源，' },
  { startMs: 2100, endMs: 3000, text: '即发即用不能存储的瓶颈。' },
  { startMs: 3100, endMs: 4000, text: '所以最后一句话是个对策。' },
];
describe('verbatim watched note selection', (): void => {
  it('rejects altered keywords and all free-form paraphrase fields', (): void => {
    const schema = watchedExtractSchema(sources);
    expect(schema.safeParse({ points: [{ keyword: '无需存储', sourceNumbers: [1] }] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ keyword: '储能系统', summary: '不需要存储', sourceNumbers: [0] }] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ title: '储能系统', summary: '不需要存储', sourceNumbers: [0] }] }).success).toBe(false);
  });
  it('includes unselected middle negation and surrounding source text unchanged', (): void => {
    const selection = { points: [{ sourceNumbers: [0, 2] }] };
    expect(watchedExtractSchema(sources).safeParse(selection).success).toBe(true);
    const markdown = watchedExtractMarkdown(selection, sources);
    for (const source of sources) expect(markdown).toContain(source.text);
    expect(markdown).not.toContain('无需存储'); expect(markdown).toContain('0:01、0:02、0:03');
  });
  it('rejects an empty selection instead of inventing an excerpt', (): void => {
    expect(watchedExtractSchema(sources).safeParse({ points: [{ sourceNumbers: [] }] }).success).toBe(false);
  });
  it('rejects unknown IDs without throwing and preserves a literal negation keyword', (): void => {
    const schema = watchedExtractSchema(sources);
    expect(schema.safeParse({ points: [{ sourceNumbers: [99] }] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ sourceNumbers: [1] }] }).success).toBe(true);
  });
  it('rejects over-budget context rather than silently truncating sentences', (): void => {
    expect(watchedExtractSchema([{ startMs: 0, endMs: 1000, text: '储能系统' + '字'.repeat(4500) }]).safeParse({ points: [{ sourceNumbers: [0] }] }).success).toBe(false);
  });
});
