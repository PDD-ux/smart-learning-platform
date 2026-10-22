import type { ContentRef } from './content-ref';

export type StudySearchParams = Record<string, string | string[] | undefined>;
type StudyBounds = { format?: string; contentType: 'video' | 'document'; durationSec: number | null; pageCount: number | null };

export function studyCitationUrl(contentId: string, ref: ContentRef): string {
  const query = ref.type === 'video' ? `t=${ref.timestampSec}` : `page=${ref.page}${ref.blockIndex === undefined ? '' : `&block=${ref.blockIndex}`}`;
  return `/study/${encodeURIComponent(contentId)}?${query}`;
}

export function resolveStudyLocation(params: StudySearchParams, bounds: StudyBounds): ContentRef | null {
  const raw = bounds.contentType === 'video' ? params.t : params.page;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  if (bounds.contentType === 'video') {
    return bounds.durationSec !== null && value <= bounds.durationSec ? { type: 'video', timestampSec: value } : null;
  }
  if(bounds.format === 'EPUB' ? value !== 1 : bounds.pageCount === null || value < 1 || value > bounds.pageCount)return null;
  const block=params.block;
  return {type:'document',page:value,...(typeof block==='string'&&/^\d+$/u.test(block)&&Number.isSafeInteger(Number(block))&&Number(block)<20000?{blockIndex:Number(block)}:{})};
}
