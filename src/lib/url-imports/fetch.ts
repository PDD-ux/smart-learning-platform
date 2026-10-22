import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const URL_LIMITS = { htmlBytes: 2 * 1024 ** 2, pdfBytes: 10 * 1024 ** 2, milliseconds: 30000, redirects: 3, characters: 100000, nodes: 50000, depth: 64, preview: 12000 } as const;
export const VIDEO_URL_LIMITS = { bytes: 100 * 1024 ** 2, milliseconds: 120000, seconds: 7200 } as const;
export type DownloadedVideo = { format: 'MP4' | 'WEBM'; fileSize: number; sourceDigest: string; finalUrl: string; contentType: string; fetchedAt: string };
export class UrlImportError extends Error {
  constructor(public readonly reason: 'ADDRESS_BLOCKED' | 'FETCH_FAILED' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'CONTENT_UNREADABLE' | 'CANCELLED' | 'TIMEOUT') { super(reason); this.name = 'UrlImportError'; }
}
export function normalizedPublicUrl(input: string): URL {
  let url: URL; try { url = new URL(input.trim()); } catch { throw new UrlImportError('ADDRESS_BLOCKED'); }
  if (url.href.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname || url.hostname.endsWith('.') || /[\u0000-\u0020\u007f]/u.test(input)) throw new UrlImportError('ADDRESS_BLOCKED');
  const host=url.hostname.toLowerCase();
  if (['bilibili.com','b23.tv','youtube.com','youtu.be','douyin.com','pan.baidu.com','aliyundrive.com','alipan.com','pan.quark.cn'].some((blocked):boolean=>host===blocked||host.endsWith('.'+blocked))) throw new UrlImportError('UNSUPPORTED_TYPE');
  url.hash = ''; return url;
}
export function publicAddress(address: string): boolean {
  if (!isIP(address)) return false;
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
function sameAddress(left: string, right: string): boolean {
  try { return ipaddr.process(left).toString() === ipaddr.process(right).toString(); } catch { return false; }
}
export async function publicTarget(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.length > 16 || addresses.some((entry): boolean => !publicAddress(entry.address) || ![4, 6].includes(entry.family))) throw new UrlImportError('ADDRESS_BLOCKED');
  return { address: addresses[0].address, family: addresses[0].family as 4 | 6 };
}
type Hop = { location?: string; bytes?: Buffer; format?: 'MD' | 'PDF'; contentType?: string; video?: Omit<DownloadedVideo, 'finalUrl' | 'fetchedAt'> };
async function downloadHop(url: URL, target: { address: string; family: 4 | 6 }, signal: AbortSignal, videoPath?: string): Promise<Hop> {
  return new Promise<Hop>((resolve, reject): void => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(url, { agent: false, family: target.family, maxHeaderSize: 16384, signal,
      lookup: (_hostname, _options, callback): void => { callback(null, target.address, target.family); },
      headers: { Accept: videoPath ? 'video/mp4,video/webm' : 'text/html,application/xhtml+xml,application/pdf', 'Accept-Encoding': 'identity', 'User-Agent': 'Wenhao-Learning-Import/1.0' },
    }, (response: IncomingMessage): void => {
      void (async (): Promise<void> => {
        if (!response.socket.remoteAddress || !publicAddress(response.socket.remoteAddress) || !sameAddress(response.socket.remoteAddress, target.address)) throw new UrlImportError('ADDRESS_BLOCKED');
        const status = response.statusCode ?? 0;
        if ([301,302,303,307,308].includes(status)) { if (!response.headers.location) throw new UrlImportError('FETCH_FAILED'); response.destroy(); resolve({ location: response.headers.location }); return; }
        if (status !== 200) throw new UrlImportError('FETCH_FAILED');
        const encoding = response.headers['content-encoding']; if (encoding && encoding.toLowerCase() !== 'identity') throw new UrlImportError('UNSUPPORTED_TYPE');
        const contentType = response.headers['content-type'] ?? '', mime = contentType.split(';')[0].trim().toLowerCase();
        if (videoPath) {
          const videoFormat = mime === 'video/mp4' ? 'MP4' : mime === 'video/webm' ? 'WEBM' : null;
          if (!videoFormat) throw new UrlImportError('UNSUPPORTED_TYPE');
          const declared = response.headers['content-length'];
          if (declared && (!/^\d+$/u.test(declared) || Number(declared) > VIDEO_URL_LIMITS.bytes)) throw new UrlImportError('TOO_LARGE');
          let length = 0, header = Buffer.alloc(0); const hash = createHash('sha256');
          const verify = (): boolean => videoFormat === 'MP4' ? header.subarray(4, 8).toString('ascii') === 'ftyp' : header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
          const meter = new Transform({ transform(chunk: Buffer, _encoding, callback): void {
            length += chunk.length;
            if (length > VIDEO_URL_LIMITS.bytes) { callback(new UrlImportError('TOO_LARGE')); return; }
            if (header.length < 12) header = Buffer.concat([header, chunk.subarray(0, 12 - header.length)]);
            if (header.length >= 12 && !verify()) { callback(new UrlImportError('UNSUPPORTED_TYPE')); return; }
            hash.update(chunk); callback(null, chunk);
          } });
          await pipeline(response, meter, createWriteStream(videoPath, { flags: 'wx' }), { signal });
          if (length < 12 || !verify()) throw new UrlImportError('UNSUPPORTED_TYPE');
          if (declared !== undefined && Number(declared) !== length) throw new UrlImportError('FETCH_FAILED');
          resolve({ video: { format: videoFormat, fileSize: length, sourceDigest: hash.digest('hex'), contentType: mime } }); return;
        }
        const format = mime === 'application/pdf' ? 'PDF' : ['text/html','application/xhtml+xml'].includes(mime) ? 'MD' : null;
        if (!format) throw new UrlImportError('UNSUPPORTED_TYPE'); const maximum = format === 'PDF' ? URL_LIMITS.pdfBytes : URL_LIMITS.htmlBytes;
        const declared = response.headers['content-length']; if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) throw new UrlImportError('TOO_LARGE');
        const chunks: Buffer[] = []; let length = 0;
        for await (const raw of response as AsyncIterable<Buffer>) { if (signal.aborted) throw new UrlImportError('CANCELLED'); const chunk = Buffer.from(raw); length += chunk.length; if (length > maximum) throw new UrlImportError('TOO_LARGE'); chunks.push(chunk); }
        if (!length || declared !== undefined && Number(declared) !== length) throw new UrlImportError('FETCH_FAILED');
        const bytes = Buffer.concat(chunks); if (format === 'PDF' && bytes.subarray(0,5).toString('ascii') !== '%PDF-') throw new UrlImportError('UNSUPPORTED_TYPE');
        resolve({ bytes, format, contentType });
      })().catch((error: unknown): void => { response.destroy(); reject(error); });
    });
    request.on('socket',(socket):void=>{const verify=():void=>{if(!socket.remoteAddress||!publicAddress(socket.remoteAddress)||!sameAddress(socket.remoteAddress,target.address))request.destroy(new UrlImportError('ADDRESS_BLOCKED'));};if(socket.connecting)socket.once('connect',verify);else verify();});
    request.on('error', (error: unknown): void => { reject(error); }); request.end();
  });
}
export type DownloadedDocument = { bytes: Buffer; format: 'MD' | 'PDF'; finalUrl: string; contentType: string; fetchedAt: string };
/** Fresh public DNS approval, pinned socket and no cookies on every redirect. No URL/error is logged. */
async function fetchPublic(input: string, parent?: AbortSignal, videoPath?: string): Promise<DownloadedDocument | DownloadedVideo> {
  const controller = new AbortController(), deadline = setTimeout((): void => controller.abort(), videoPath ? VIDEO_URL_LIMITS.milliseconds : URL_LIMITS.milliseconds);
  const cancel = (): void => controller.abort(); parent?.addEventListener('abort', cancel, { once: true }); if (parent?.aborted) controller.abort();
  try {
    let url = normalizedPublicUrl(input); const seen = new Set<string>();
    for (let hop = 0; hop <= URL_LIMITS.redirects; hop++) {
      if (controller.signal.aborted) throw new UrlImportError(parent?.aborted ? 'CANCELLED' : 'TIMEOUT');
      if (seen.has(url.href)) throw new UrlImportError('FETCH_FAILED'); seen.add(url.href);
      const target = await Promise.race([publicTarget(url), new Promise<never>((_resolve, reject): void => { const abort = (): void => reject(new UrlImportError(parent?.aborted ? 'CANCELLED' : 'TIMEOUT')); if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true}); })]);
      const result = await downloadHop(url, target, controller.signal, videoPath);
      if (result.location) { if (hop === URL_LIMITS.redirects) throw new UrlImportError('FETCH_FAILED'); const next = normalizedPublicUrl(new URL(result.location, url).href); if (url.protocol === 'https:' && next.protocol !== 'https:') throw new UrlImportError('ADDRESS_BLOCKED'); url = next; continue; }
      if (result.video) return { ...result.video, finalUrl: url.href, fetchedAt: new Date().toISOString() };
      return { bytes: result.bytes!, format: result.format!, contentType: result.contentType!, finalUrl: url.href, fetchedAt: new Date().toISOString() };
    }
    throw new UrlImportError('FETCH_FAILED');
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new UrlImportError(parent?.aborted ? 'CANCELLED' : 'TIMEOUT');
    if (error instanceof UrlImportError) throw error; throw new UrlImportError('FETCH_FAILED');
  } finally { clearTimeout(deadline); parent?.removeEventListener('abort', cancel); }
}

export async function fetchPublicDocument(input: string, parent?: AbortSignal): Promise<DownloadedDocument> {
  const value = await fetchPublic(input, parent);
  if (!('bytes' in value)) throw new UrlImportError('UNSUPPORTED_TYPE');
  return value;
}

/** Caller owns the random temporary path and removes it after success or failure. */
export async function fetchPublicVideo(input: string, filePath: string, parent?: AbortSignal): Promise<DownloadedVideo> {
  const value = await fetchPublic(input, parent, filePath);
  if ('bytes' in value) throw new UrlImportError('UNSUPPORTED_TYPE');
  return value;
}
