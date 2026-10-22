/** Matching ignores presentation whitespace, never numbers or words. */
export function documentTextKey(text: string): string {
  return text.normalize('NFKC').replace(/\s/gu, '');
}

/** Return actual source characters rather than trusting model punctuation/spacing. */
export function documentQuote(source: string, candidate: string, minimum = 12): string | null {
  const needle = documentTextKey(candidate);
  if (needle.length < minimum) return null;
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of source) {
    const value = documentTextKey(character);
    for (let index = 0; index < value.length; index += 1) {
      starts.push(offset); ends.push(offset + character.length);
    }
    normalized += value;
    offset += character.length;
  }
  const start = normalized.indexOf(needle);
  return start < 0 ? null : source.slice(starts[start], ends[start + needle.length - 1]);
}

export function isDocumentNavigation(text: string): boolean {
  const key = documentTextKey(text);
  const directory = /(?:^|\n)\s*目\s*录(?:\s|$)/u.test(text) && (key.match(/\.{3,}|…{2,}/gu)?.length ?? 0) >= 3;
  const cover = key.length <= 300 && /(?:主讲|编著|主编|授课教师)[:：]/u.test(key) && !/[。！？=÷×%]/u.test(key);
  return directory || cover;
}

export function uniqueDocumentFacts<T extends { summary: string }>(points: T[]): T[] {
  const accepted: T[] = [];
  for (const point of points) {
    const key = documentTextKey(point.summary);
    if (!accepted.some((previous): boolean => {
      const other = documentTextKey(previous.summary);
      return key.includes(other) || other.includes(key);
    })) accepted.push(point);
  }
  return accepted;
}

export type DocumentFact = { id: string; sourceId: string; title: string; text: string };

/** Sentence/line boundaries preserve concrete subjects and formulas; no model-written prose. */
export function documentFacts(sources: Array<{ id: string; text: string }>): DocumentFact[] {
  const facts: DocumentFact[] = [];
  for (const source of sources) {
    for (const part of source.text.split(/\r?\n|(?<=[。！？；])/u)) {
      const text = part.trim();
      const key = documentTextKey(text);
      if (key.length < 12 || text.length > 700) continue;
      // PDF running headers and numbered headings are navigation, not recall facts.
      if (/^(?:https?:\/\/|www\.)/iu.test(key) && !/[。！？；]/u.test(key)) continue;
      if (/^(?:第[\d一二三四五六七八九十百]+[章节篇]|[\d一二三四五六七八九十]+[、.．]|[（(][\d一二三四五六七八九十]+[)）])/u.test(key)
        && !/[。！？；=÷×%]|[:：].{3,}$/u.test(key)) continue;
      const colon = text.search(/[:：]/u);
      const title = (colon >= 2 && colon <= 50 ? text.slice(0, colon) : text.slice(0, 24)).trim();
      if (documentTextKey(title).length < 2) continue;
      facts.push({ id: `F${facts.length + 1}`, sourceId: source.id, title, text });
    }
  }
  return facts;
}

export function parseDocumentFactSelection(text: string, facts: DocumentFact[]): { points: Array<{ title: string; summary: string; sourceIds: string[] }> } {
  const match = /^事实\s*[:：]\s*(F\d+(?:\s*[,，、]\s*F\d+){0,2})\s*$/u.exec(text.trim());
  if (!match) throw new Error('仅允许单行事实:F1,F2，选择1至3个本批实际编号');
  const ids = match[1].split(/\s*[,，、]\s*/u);
  if (new Set(ids).size !== ids.length) throw new Error('事实编号不得重复');
  return { points: ids.map((id): { title: string; summary: string; sourceIds: string[] } => {
    const fact = facts.find((candidate): boolean => candidate.id === id);
    if (!fact) throw new Error('事实编号不存在');
    return { title: fact.title, summary: fact.text, sourceIds: [fact.sourceId] };
  }) };
}
