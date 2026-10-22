import type { ContentRef } from './content-ref';
type Source = { ref: ContentRef; text: string };

/** Keep nearby evidence for a specific question; generic questions retain the full bounded context. */
export function selectQaSources(sources: Source[], question: string): Source[] {
  const query = question.replace(/资料|原文|引用|说明|为什么|什么|这个|如何|视频|回答|请/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const grams = new Set(Array.from({ length: Math.max(0, query.length - 1) }, (_, index) => query.slice(index, index + 2)));
  const ranked = sources.map((source, index) => ({ index, score: [...grams].filter((gram) => source.text.includes(gram)).length })).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  if (best < 3) return sources;
  const anchors = ranked.filter((row) => row.score >= Math.max(3, best * 0.6)).slice(0, 3);
  return sources.filter((source, index) => anchors.some((anchor) => {
    if (index < anchor.index || index - anchor.index > 3) return false;
    const ref = sources[anchor.index].ref;
    if (source.ref.type === 'video' && ref.type === 'video') return Math.abs(source.ref.timestampSec - ref.timestampSec) <= 25;
    return source.ref.type === 'document' && ref.type === 'document' && source.ref.page === ref.page;
  }));
}
