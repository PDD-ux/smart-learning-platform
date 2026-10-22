import { Readable } from 'node:stream';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus } from '@/lib/api/response';
import { getStorage, StorageError, verifyStorageToken } from '@/lib/storage';
import { parseRangeHeader } from '@/lib/storage-range';
import { materializeObject } from '@/lib/media/materialize';
import { renderPdfPages } from '@/lib/media/pdf-render';

/**
 * 本地对象读取（tasks.md §4.1 local 驱动配套）
 * ------------------------------------------------------------
 * GET /api/storage/object?key=&expires=&sig=
 *   - 校验 HMAC 预签名令牌（等价 S3 预签名 GET）
 *   - 支持 HTTP Range 断点（206 + Content-Range），视频流式播放
 *
 * 仅 local 驱动使用；s3 驱动下前端直连对象存储读取。
 */

export const runtime = 'nodejs';

function safeDownloadName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'download';
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') ?? '';
  const sig = searchParams.get('sig') ?? '';
  const expires = Number(searchParams.get('expires'));

  if (
    !key ||
    !sig ||
    !Number.isFinite(expires) ||
    !verifyStorageToken('get', key, sig, expires)
  ) {
    return fail(ErrorCode.FORBIDDEN, '读取地址无效或已过期', HttpStatus.FORBIDDEN);
  }

  const storage = getStorage();
  const requestedPage = Number(searchParams.get('page'));
  if (Number.isInteger(requestedPage) && requestedPage > 0) {
    if (!key.toLowerCase().endsWith('.pdf')) return fail(ErrorCode.VALIDATION_FAILED, '仅 PDF 支持逐页阅读', HttpStatus.BAD_REQUEST);
    const materialized = await materializeObject(storage, key);
    const outputDir = path.join(tmpdir(), `slp-reader-${randomUUID()}`);
    try {
      const rendered = await renderPdfPages(materialized.filePath, [requestedPage], outputDir);
      const page = rendered[0];
      if (!page) return fail(ErrorCode.NOT_FOUND, 'PDF 页码不存在', HttpStatus.NOT_FOUND);
      return new Response(await readFile(page.filePath), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=600' } });
    } catch {
      return fail(ErrorCode.INTERNAL, 'PDF 页面生成失败，请稍后重试', HttpStatus.INTERNAL);
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
      await materialized.cleanup();
    }
  }
  const parsed = parseRangeHeader(request.headers.get('range'));

  let range: { start: number; end?: number } | undefined;
  if (parsed) {
    if (parsed.suffix !== undefined) {
      const stat = await storage.statObject(key);
      if (!stat) {
        return fail(ErrorCode.NOT_FOUND, '文件不存在', HttpStatus.NOT_FOUND);
      }
      range = { start: Math.max(0, stat.size - parsed.suffix) };
    } else if (parsed.start !== undefined) {
      range = { start: parsed.start, end: parsed.end };
    }
  }

  try {
    const object = await storage.getObject(key, range);
    const headers = new Headers({
      'Content-Type': object.contentType,
      'Content-Length': String(object.contentLength),
      'Accept-Ranges': 'bytes',
    });
    const downloadName = searchParams.get('download');
    if (downloadName) {
      headers.set('Content-Disposition', `attachment; filename="${safeDownloadName(downloadName)}"`);
    }
    if (object.contentRange) {
      headers.set('Content-Range', object.contentRange);
    }
    return new Response(Readable.toWeb(object.stream) as unknown as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (err) {
    if (err instanceof StorageError) {
      if (err.code === 'NOT_FOUND') {
        return fail(ErrorCode.NOT_FOUND, '文件不存在', HttpStatus.NOT_FOUND);
      }
      if (err.code === 'RANGE_NOT_SATISFIABLE') {
        return fail(ErrorCode.VALIDATION_FAILED, '请求范围不合法', 416);
      }
      return fail(
        ErrorCode.STORAGE_UNAVAILABLE,
        '存储服务暂时不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw err;
  }
}
