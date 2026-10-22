import { createReadStream } from 'node:fs';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffprobePath } from '@/lib/media/ffmpeg';
import { runText } from '@/lib/media/ffmpeg-runner';
import { getStorage } from '@/lib/storage';
import type { UrlSource } from '@/lib/url-imports/contracts';
import { fetchPublicVideo, VIDEO_URL_LIMITS, UrlImportError } from '@/lib/url-imports/fetch';

type Probe = { format?: { duration?: string }; streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[] };
export type VideoSnapshot = { format: 'MP4' | 'WEBM'; storageKey: string; fileSize: number; durationSec: number; source: UrlSource };

/** Stream to a private object only after bounded, local-only media validation. */
export async function downloadVideoSnapshot(url: string, draftId: string, signal: AbortSignal): Promise<VideoSnapshot> {
  const directory = await mkdtemp(path.join(tmpdir(), 'slp-video-url-'));
  const filePath = path.join(directory, 'download');
  try {
    const download = await fetchPublicVideo(url, filePath, signal);
    if (signal.aborted) throw new UrlImportError('CANCELLED');
    let probe: Probe;
    try {
      probe = JSON.parse(await runText(ffprobePath(), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-print_format', 'json', '-show_format', '-show_streams', filePath], 30000)) as Probe;
    } catch { throw new UrlImportError('CONTENT_UNREADABLE'); }
    const track = probe.streams?.find((stream): boolean => stream.codec_type === 'video');
    const duration = Number(probe.format?.duration);
    const allowed = download.format === 'MP4' ? ['h264'] : ['vp8', 'vp9', 'av1'];
    if (!track || !allowed.includes(track.codec_name ?? '') || !Number.isFinite(duration) || duration <= 0 || duration > VIDEO_URL_LIMITS.seconds || !(track.width && track.width > 0 && track.width <= 8192 && track.height && track.height > 0 && track.height <= 8192)) throw new UrlImportError('CONTENT_UNREADABLE');
    if (signal.aborted) throw new UrlImportError('CANCELLED');
    const storageKey = `contents/url-${draftId}/source.${download.format.toLowerCase()}`;
    await getStorage().putObject(storageKey, createReadStream(filePath, { signal }), { contentType: download.contentType, contentLength: download.fileSize });
    if (signal.aborted) throw new UrlImportError('CANCELLED');
    let title = '链接课堂视频';
    try { title = decodeURIComponent(new URL(download.finalUrl).pathname.split('/').at(-1) ?? '').replace(/\.(mp4|webm)$/iu, '').replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100) || title; } catch { /* Unknown source title stays explicit. */ }
    return { format: download.format, storageKey, fileSize: download.fileSize, durationSec: Math.ceil(duration), source: { version: 1, requestedUrl: url, finalUrl: download.finalUrl, title, author: null, publishedLabel: null, fetchedAt: download.fetchedAt, sourceDigest: download.sourceDigest, contentDigest: download.sourceDigest, previousContentId: null } };
  } finally {
    await rm(filePath, { force: true });
    await rmdir(directory);
  }
}
