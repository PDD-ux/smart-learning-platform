import { isRefInRange, type ContentRef } from './content-ref';

export type QaCitation = { ref: ContentRef; excerpt: string };
type CitationBounds = { contentType: 'video' | 'document'; durationSec: number | null; pageCount: number | null };

function sameLocation(left: ContentRef, right: ContentRef): boolean {
  if (left.type === 'video' && right.type === 'video') return left.timestampSec === right.timestampSec;
  return left.type === 'document' && right.type === 'document' && left.page === right.page && left.blockIndex === right.blockIndex;
}

/** Only use retained source text; never repair transcription or invent an unverified location. */
export function groundQaCitations(
  citations: QaCitation[],
  sources: { ref: ContentRef; text: string }[],
  bounds: CitationBounds,
): QaCitation[] {
  const result: QaCitation[] = [];
  const seen = new Set<string>();
  const retained = sources.filter((source) => source.ref.type === bounds.contentType && isRefInRange(source.ref, bounds) && source.text.trim());
  for (const citation of citations) {
    if (citation.ref.type !== bounds.contentType) continue;
    const excerpt = citation.excerpt.trim();
    if (!excerpt) continue;
    const candidates = retained.filter((source) => (
      sameLocation(citation.ref, source.ref) ||
      (citation.ref.type === 'document' && citation.ref.blockIndex === undefined && source.ref.type === 'document' && citation.ref.page === source.ref.page)
    ));
    const matching = candidates.filter((source) => source.text.includes(excerpt));
    // An omitted document block is only resolvable from a unique verbatim match.
    const ambiguousPage = citation.ref.type === 'document' && citation.ref.blockIndex === undefined && candidates.length > 1;
    if (ambiguousPage && matching.length !== 1) continue;
    // Repair only when the model copied an identifiable source prefix before splicing.
    // A valid timestamp alone is not evidence that its text supports this quotation.
    const anchored = candidates.filter((source) => excerpt.startsWith(source.text.trim().slice(0, Math.min(12, source.text.trim().length))));
    const globalMatching = retained.filter((source) => source.text.includes(excerpt));
    const globalAnchored = retained.filter((source) => excerpt.startsWith(source.text.trim().slice(0, Math.min(12, source.text.trim().length))));
    // If the model used a neighbouring label, the uniquely matching quote identifies
    // the real location. No arbitrary nearest-time or page inference is permitted.
    const source = matching[0] ?? (anchored.length === 1 ? anchored[0] : undefined)
      ?? (globalMatching.length === 1 ? globalMatching[0] : undefined)
      ?? (globalAnchored.length === 1 ? globalAnchored[0] : undefined);
    if (!source) continue;
    const verified = { ref: source.ref, excerpt: (source.text.includes(excerpt) ? excerpt : source.text.trim()).slice(0, 500) };
    const key = JSON.stringify(verified);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(verified);
  }
  return result;
}
