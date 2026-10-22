import { inflateSync } from 'node:zlib';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
function invalid(): never { throw new ApiError(ErrorCode.VALIDATION_FAILED, '附件实际格式无效、损坏或超过图像尺寸限制，请重新选择文件'); }
export async function validateAssignmentFile(bytes: Buffer, mime: string): Promise<void> {
 if (!bytes.length) return invalid();
 if (mime === 'text/plain' || mime === 'text/markdown') { try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) return invalid(); return; } catch { return invalid(); } }
 if (mime === 'application/pdf') {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') return invalid();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableAutoFetch: true });
  try { const pdf = await loading.promise; if (pdf.numPages < 1 || pdf.numPages > 2000) return invalid(); } catch { return invalid(); } finally { await loading.destroy(); } return;
 }
 if (mime === 'image/png') {
  if (bytes.length < 45 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return invalid();
  let position = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0; const data: Buffer[] = []; let ended = false;
  while (position + 12 <= bytes.length) { const size = bytes.readUInt32BE(position), type = bytes.subarray(position+4,position+8).toString('ascii'); if (size > bytes.length-position-12) return invalid(); const chunk = bytes.subarray(position+8,position+8+size);
   if (type === 'IHDR') { if (position !== 8 || size !== 13) return invalid(); width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; color = chunk[9]; interlace = chunk[12]; if (!width || !height || width*height > 20000000 || chunk[10] !== 0 || chunk[11] !== 0 || interlace > 1) return invalid(); }
   if (type === 'IDAT') data.push(chunk); position += size+12;
   if (type === 'IEND') { if (size || position !== bytes.length) return invalid(); ended = true; break; }
  }
  if (!ended || !data.length || ![1,2,4,8,16].includes(depth) || ![0,2,3,4,6].includes(color)) return invalid();
  const channels = ({ 0:1, 2:3, 3:1, 4:2, 6:4 } as Record<number,number>)[color];
  try { const raw = inflateSync(Buffer.concat(data), { maxOutputLength: 180000000 }); if (!raw.length || (!interlace && raw.length !== height*(1+Math.ceil(width*channels*depth/8)))) return invalid(); } catch { return invalid(); } return;
 }
 if (mime === 'image/jpeg') {
  if (bytes.length < 10 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes.at(-1) !== 217) return invalid();
  let position = 2, found = false, scan = false;
  while (position+4 <= bytes.length) { if (bytes[position++] !== 255) return invalid(); while (bytes[position] === 255) position++; const marker = bytes[position++]; if (marker === 217) break; if (marker === 218) { scan = true; break; } if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
   const size = bytes.readUInt16BE(position); if (size < 2 || position+size > bytes.length) return invalid();
   if ([192,193,194].includes(marker)) { if (size < 8) return invalid(); const height = bytes.readUInt16BE(position+3), width = bytes.readUInt16BE(position+5); if (!width || !height || width*height > 20000000) return invalid(); found = true; } position += size;
  }
  if (!found || !scan) return invalid(); return;
 }
 return invalid();
}
