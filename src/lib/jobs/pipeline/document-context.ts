import { AiError, modelProvider, type ModelProvider } from '@/lib/ai/spark';
import { contentRefSchema, isRefInRange, type ContentRef, type DocumentRef } from '@/lib/domain/content-ref';
import type { StructuredContext } from './context-builder';

/** Preserve every nonblank source character, including oversized pages. */
export function documentContexts(context: StructuredContext, pageCount: number | null): StructuredContext[] {
  if (context.truncated) throw new AiError('文档来源已截断，无法分批整理', 'SCHEMA_INVALID', 502);
  if (context.stats.transcriptCount > 0 || context.stats.textBlockCount !== context.sourceSegments.length) {
    throw new AiError('文档解析记录缺少有效来源，无法保证完整处理', 'SCHEMA_INVALID', 502);
  }
  const segments = context.sourceSegments.map((source, index): { ref: DocumentRef; text: string; index: number } => {
    const parsed = contentRefSchema.safeParse(source.ref);
    if (!parsed.success || parsed.data.type !== 'document' || !isRefInRange(parsed.data, { pageCount, durationSec: null })) {
      throw new AiError('文档来源页码非法', 'SCHEMA_INVALID', 502);
    }
    return { ...source, ref: parsed.data, index };
  }).filter((source): boolean => Boolean(source.text.trim()))
    .sort((a, b): number => a.ref.page - b.ref.page || (a.ref.blockIndex ?? 0) - (b.ref.blockIndex ?? 0) || a.index - b.index);
  if (!segments.length && context.text.trim()) throw new AiError('文档没有可引用正文', 'SCHEMA_INVALID', 502);
  const batches: StructuredContext[] = [];
  let batch: StructuredContext['sourceSegments'] = [];
  let chars = 0;
  let pages = new Set<number>();
  const flush = (): void => {
    if (!batch.length) return;
    if (batches.length >= 48) throw new AiError('文档超过48批处理上限，请拆分资料', 'SCHEMA_INVALID', 502);
    batches.push({ text: batch.map((source): string => source.text).join('\n'), sourceSegments: batch,
      sourceRefs: batch.map((source): ContentRef => source.ref), noteTexts: [], truncated: false,
      stats: { transcriptCount: 0, textBlockCount: batch.length, noteCount: 0 } });
    batch = []; chars = 0; pages = new Set<number>();
  };
  for (const source of segments) {
    for (let offset = 0; offset < source.text.length;) {
      if (chars >= 7_000 || (!pages.has(source.ref.page) && pages.size >= 12)) flush();
      let length = Math.min(7_000 - chars, source.text.length - offset);
      // Do not send half of an astral character to separate model requests.
      const last = source.text.charCodeAt(offset + length - 1);
      const next = source.text.charCodeAt(offset + length);
      if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) length -= 1;
      if (!length) { flush(); continue; }
      batch.push({ ref: source.ref, text: source.text.slice(offset, offset + length) });
      chars += length; pages.add(source.ref.page); offset += length;
    }
  }
  flush();
  return batches;
}

export function documentModelProvider(): ModelProvider {
  return modelProvider();
}
