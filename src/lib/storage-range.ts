export type ParsedRange = { start?: number; end?: number; suffix?: number };

/** 解析 `Range: bytes=start-end` / `bytes=start-` / `bytes=-suffix`。 */
export function parseRangeHeader(header: string | null): ParsedRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') return { suffix: Number(rawEnd) };
  return { start: Number(rawStart), end: rawEnd === '' ? undefined : Number(rawEnd) };
}
