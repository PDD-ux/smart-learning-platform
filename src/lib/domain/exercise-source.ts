import { contentRefSchema, isRefInRange, refSortKey, refTypeMatches, type ContentRef } from './content-ref';
import type { ContentSummary, Understanding } from '@/services/api';

export type ExerciseSource = { title: string; summary: string; refs: ContentRef[] };

/** Use only the linked point and its current, verifiable source anchors. */
export function exerciseSource(content: ContentSummary, understanding: Understanding, pointId: string): ExerciseSource | null {
  if (content.contentId !== understanding.contentId) throw new Error('资料来源不一致，请重新加载');
  const point = understanding.knowledgePoints.find((item) => item.pointId === pointId);
  if (!point) return null;
  const sources: ContentRef[] = understanding.textBlocks.flatMap((block): ContentRef[] => {
    const parsed = contentRefSchema.safeParse(block.ref);
    return parsed.success && block.text.trim() ? [parsed.data] : [];
  });
  if (content.contentType === 'video') {
    for (const segment of understanding.transcriptSegments) {
      if (Number.isFinite(segment.startMs) && segment.startMs >= 0 && segment.text.trim()) {
        sources.push({ type: 'video', timestampSec: Math.floor(segment.startMs / 1000) });
      }
    }
  }
  const unique = new Map<string, ContentRef>();
  for (const candidate of point.refs) {
    const parsed = contentRefSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const ref = parsed.data;
    if (!refTypeMatches(ref, content.contentType) || !isRefInRange(ref, content)) continue;
    const supported = sources.some((source) => source.type === ref.type && (ref.type === 'video'
      ? source.type === 'video' && source.timestampSec === ref.timestampSec
      : source.type === 'document' && source.page === ref.page && (ref.blockIndex === undefined || source.blockIndex === ref.blockIndex)));
    if (!supported) continue;
    // The reader supports page navigation, so multiple blocks on one page share one link.
    unique.set(ref.type === 'video' ? `t:${ref.timestampSec}` : `page:${ref.page}`, ref);
  }
  return { title: point.title, summary: point.summary, refs: [...unique.values()].sort((a, b) => refSortKey(a) - refSortKey(b)) };
}
