import { z } from 'zod';
import { contentRefSchema, type VideoRef } from '../../src/lib/domain/content-ref';

export const repairPlanSchema = z.object({
  task: z.literal('6.4'),
  review: z.literal('source excerpts reviewed'),
  points: z.array(z.object({
    pointId: z.string().min(1), contentId: z.string().min(1), title: z.string().min(1), summary: z.string().min(1),
    evidence: z.array(z.object({ startMs: z.number().int().nonnegative(), text: z.string().min(1) })).min(1).max(20),
  })).min(1).max(20),
});
export type RepairPoint = z.infer<typeof repairPlanSchema>['points'][number];
export type RepairSource = {
  id: string; contentId: string; title: string; summary: string; refs: unknown;
  durationSec: number | null; transcripts: { startMs: number; text: string }[];
};

/** Reviewed excerpts authorize exact source positions; never infer positions from prose. */
export function reviewedRefs(plan: RepairPoint, source: RepairSource): VideoRef[] {
  if (source.id !== plan.pointId || source.contentId !== plan.contentId || source.title !== plan.title || source.summary !== plan.summary) throw new Error('STALE_POINT');
  if (source.durationSec === null || !Number.isFinite(source.durationSec) || source.durationSec < 0) throw new Error('MISSING_DURATION');
  const refs: VideoRef[] = [];
  for (const evidence of plan.evidence) {
    if (!source.transcripts.some(row => row.startMs === evidence.startMs && row.text === evidence.text)) throw new Error('STALE_EVIDENCE');
    if (evidence.startMs > source.durationSec * 1000) throw new Error('REF_OUT_OF_RANGE');
    const parsed = contentRefSchema.parse({ type: 'video', timestampSec: Math.floor(evidence.startMs / 1000) });
    if (parsed.type !== 'video') throw new Error('INVALID_REF');
    if (!refs.some(ref => ref.timestampSec === parsed.timestampSec)) refs.push(parsed);
  }
  refs.sort((a, b) => a.timestampSec - b.timestampSec);
  const existing = JSON.stringify(source.refs);
  if (existing !== '[]' && existing !== JSON.stringify(refs)) throw new Error('EXISTING_REFS_PRESERVED');
  return refs;
}
