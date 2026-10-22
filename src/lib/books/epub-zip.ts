import { crc32, inflateRawSync } from 'node:zlib';

export const EPUB_LIMITS = { bytes: 50 * 1024 ** 2, entries: 2000, entryBytes: 4 * 1024 ** 2, totalBytes: 32 * 1024 ** 2, ratio: 200, characters: 2_000_000, nodes: 100_000, depth: 64, spine: 200 } as const;
export function epubFailure(): Error { return new Error('EPUB格式损坏、受保护或超过安全限制；请改用无DRM的标准EPUB/PDF。'); }
export function archivePath(value: string): string {
  if (!value || value.length > 512 || /[:%?#]/u.test(value) || [...value].some((character): boolean => character.charCodeAt(0) < 32 || [92, 127].includes(character.charCodeAt(0))) || value.startsWith('/') || value.split('/').some((part): boolean => part === '..' || part === '.' || !part)) throw epubFailure();
  return value;
}
/** Strict ZIP subset for EPUB: validate the whole directory before allocating any inflated file. */
export function epubArchive(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length < 22 || bytes.length > EPUB_LIMITS.bytes) throw epubFailure();
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) throw epubFailure();
  const count = bytes.readUInt16LE(eocd + 10), size = bytes.readUInt32LE(eocd + 12), offset = bytes.readUInt32LE(eocd + 16);
  if (!count || count > EPUB_LIMITS.entries || bytes.readUInt16LE(eocd + 8) !== count || offset + size !== eocd) throw epubFailure();
  const records: { name: string; start: number; end: number; original: number; compressed: number; checksum: number; method: number; local: number }[] = [];
  const names = new Set<string>(); let cursor = offset, total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw epubFailure();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), checksum = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), original = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || flags & ~0x080e || flags & 1 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) || (bytes.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) throw epubFailure();
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = decoder.decode(rawName);
    // Directory markers are accepted but never written to the filesystem.
    archivePath(name.endsWith('/') ? name.slice(0, -1) : name);
    if (names.has(name) || local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw epubFailure(); names.add(name);
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    if (localNameLength !== nameLength || !rawName.equals(bytes.subarray(local + 30, local + 30 + localNameLength)) || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw epubFailure();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== checksum || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== original)) throw epubFailure();
    for (const [from, length] of [[cursor + 46 + nameLength, extraLength], [local + 30 + localNameLength, localExtra]]) {
      if (from + length > bytes.length) throw epubFailure();
      for (let at = from; at < from + length;) { if (at + 4 > from + length) throw epubFailure(); const id = bytes.readUInt16LE(at), length2 = bytes.readUInt16LE(at + 2); if (id === 1 || at + 4 + length2 > from + length) throw epubFailure(); at += 4 + length2; }
    }
    const start = local + 30 + localNameLength + localExtra, end = start + compressed;
    total += original;
    if (method === 0 && compressed !== original || end > offset || original > EPUB_LIMITS.entryBytes || total > EPUB_LIMITS.totalBytes || original > Math.max(1, compressed) * EPUB_LIMITS.ratio || name.endsWith('/') && (original || compressed)) throw epubFailure();
    if (name === 'mimetype' && (local !== 0 || method !== 0 || localExtra !== 0 || flags & 8)) throw epubFailure();
    records.push({ name, start, end, original, compressed, checksum, method, local }); cursor = next;
  }
  if (cursor !== eocd) throw epubFailure();
  const ordered = [...records].sort((a, b): number => a.local - b.local);
  for (let index = 1; index < ordered.length; index++) if (ordered[index].local < ordered[index - 1].end) throw epubFailure();
  const result = new Map<string, Buffer>(); const started = Date.now();
  for (const record of records) {
    if (Date.now() - started > 10000) throw epubFailure();
    const compressed = bytes.subarray(record.start, record.end);
    const value = record.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, record.original) });
    if (value.length !== record.original || crc32(value) !== record.checksum) throw epubFailure(); result.set(record.name, value);
  }
  if (result.get('mimetype')?.toString('ascii') !== 'application/epub+zip' || result.has('META-INF/encryption.xml') || result.has('META-INF/rights.xml')) throw epubFailure();
  return result;
}
