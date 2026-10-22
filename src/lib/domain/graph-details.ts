import type { Prisma } from '@prisma/client';

export type GraphPointReference = { id: string; contentId: string; refs: Prisma.JsonValue };
export type GraphNoteReference = { contentId: string; ref: Prisma.JsonValue };
export type GraphFlashcardReference = { pointId: string | null; reviewLogs: { reviewedAt: Date }[] };

export type GraphPointDetails = {
  relatedNoteCount: number;
  relatedFlashcardCount: number;
  lastReviewedAt: string | null;
};

function referenceKey(value: Prisma.JsonValue): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields = value as Prisma.JsonObject;
  if (fields.type === 'video' && typeof fields.timestampSec === 'number') {
    return `video:${fields.timestampSec}`;
  }
  if (fields.type === 'document' && typeof fields.page === 'number') {
    return `document:${fields.page}`;
  }
  return null;
}

function pointReferenceKeys(refs: Prisma.JsonValue): Set<string> {
  if (!Array.isArray(refs)) return new Set();
  return new Set(refs.flatMap((ref) => {
    const key = referenceKey(ref);
    return key ? [key] : [];
  }));
}

export function buildGraphPointDetails(
  points: GraphPointReference[],
  notes: GraphNoteReference[],
  flashcards: GraphFlashcardReference[],
): Map<string, GraphPointDetails> {
  const noteKeysByContent = new Map<string, Map<string, number>>();
  for (const note of notes) {
    const key = referenceKey(note.ref);
    if (!key) continue;
    const keys = noteKeysByContent.get(note.contentId) ?? new Map<string, number>();
    keys.set(key, (keys.get(key) ?? 0) + 1);
    noteKeysByContent.set(note.contentId, keys);
  }

  const details = new Map(points.map((point) => [point.id, {
    relatedNoteCount: 0,
    relatedFlashcardCount: 0,
    lastReviewedAt: null as string | null,
  }]));

  for (const point of points) {
    const pointKeys = pointReferenceKeys(point.refs);
    const noteKeys = noteKeysByContent.get(point.contentId);
    let relatedNoteCount = 0;
    if (noteKeys) {
      for (const key of pointKeys) relatedNoteCount += noteKeys.get(key) ?? 0;
    }
    const current = details.get(point.id);
    if (current) current.relatedNoteCount = relatedNoteCount;
  }

  for (const card of flashcards) {
    if (!card.pointId) continue;
    const current = details.get(card.pointId);
    if (!current) continue;
    current.relatedFlashcardCount += 1;
    const reviewedAt = card.reviewLogs[0]?.reviewedAt;
    if (reviewedAt && (!current.lastReviewedAt || reviewedAt.toISOString() > current.lastReviewedAt)) {
      current.lastReviewedAt = reviewedAt.toISOString();
    }
  }
  return details;
}
