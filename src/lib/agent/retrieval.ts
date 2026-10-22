import { checkContent, sanitizeInput } from '@/lib/ai/content-guard';
import type { ContentRef } from '@/lib/domain/content-ref';

export type SearchQuery = { identifiers: string[]; terms: string[] };
export type SourceRow = { ref: ContentRef; text: string };
export type VideoWindow = { gte: number; lte: number };

export function parseSearchQuery(query: string): SearchQuery {
  const normalized = query.toLowerCase();
  const identifiers = [...new Set(normalized.match(/第[一二三四五六七八九十百零〇两\d]+[题章节讲]/g) ?? [])];
  // 用空格分隔请求用语，不能删除后把不相邻的字拼成新关键词。
  const cleaned = normalized.replace(/请|帮我|资料|视频|课程|学习|复习|解释|什么|怎么|如何|原文|重点|依据|分析|情境|内容|检索|关于|相关|并且|以及/g, ' ');
  const words = cleaned.match(/[a-z0-9]{2,}/g) ?? [];
  const chinese = cleaned.match(/[\u4e00-\u9fff]+/g) ?? [];
  const pairs = chinese.flatMap((word) => Array.from({ length: Math.max(0, word.length - 1) }, (_unused, index) => word.slice(index, index + 2)));
  return { identifiers, terms: [...new Set([...identifiers, ...words, ...pairs])].slice(0, 16) };
}

export function rankSources(rows: SourceRow[], query: SearchQuery): SourceRow[] {
  return rows.map((row, index) => {
    const text = row.text.toLowerCase();
    const identifierHits = query.identifiers.filter((identifier) => text.includes(identifier)).length;
    const score = query.identifiers.length && !identifierHits ? 0 : identifierHits * 32 + query.terms.filter((term) => text.includes(term)).length;
    return { row, index, score };
  }).filter(({ row, score }) => score > 0 && row.text.trim() && checkContent(row.text).safe)
    .sort((left, right) => right.score - left.score || left.index - right.index).map(({ row }) => row);
}

export function videoWindows(refs: ContentRef[], durationSec: number | null, leadingSeconds = 15): VideoWindow[] {
  const windows = refs.filter((ref): ref is Extract<ContentRef, { type: 'video' }> => ref.type === 'video')
    .slice(0, 4).map((ref) => ({ gte: Math.max(0, ref.timestampSec - leadingSeconds) * 1000, lte: Math.min(durationSec ?? ref.timestampSec + 90, ref.timestampSec + 90) * 1000 }))
    .sort((left, right) => left.gte - right.gte);
  const merged: VideoWindow[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.gte <= last.lte) last.lte = Math.max(last.lte, window.lte);
    else merged.push({ ...window });
  }
  return merged;
}

export function transcriptContext(rows: Array<{ startMs: number; endMs: number; text: string }>, windows: VideoWindow[]): SourceRow[] {
  const sources: SourceRow[] = [];
  for (const window of windows) {
    let current: SourceRow | undefined;
    let previousEnd = -Infinity;
    const seen = new Set<string>();
    for (const row of rows.filter((item) => item.startMs >= window.gte && item.startMs <= window.lte).sort((left, right) => left.startMs - right.startMs)) {
      const key = `${row.startMs}:${row.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!row.text.trim() || !checkContent(row.text).safe) { current = undefined; previousEnd = -Infinity; continue; }
      const text = sanitizeInput(row.text.trim(), 500);
      if (!current || row.startMs - previousEnd > 10_000 || current.text.length + text.length + 1 > 500) {
        current = { ref: { type: 'video', timestampSec: Math.floor(row.startMs / 1000) }, text };
        sources.push(current);
      } else current.text += '\n' + text;
      previousEnd = row.endMs;
    }
  }
  return sources;
}
