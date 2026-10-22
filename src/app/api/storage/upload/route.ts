import { Readable, Transform } from 'node:stream';

import { NextRequest } from 'next/server';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus } from '@/lib/api/response';
import { prisma } from '@/lib/prisma';
import { getStorage, StorageError, verifyStorageToken } from '@/lib/storage';

/**
 * 本地预签名直传接收（tasks.md §3.1 local 驱动配套）
 * ------------------------------------------------------------
 * PUT /api/storage/upload?key=&expires=&sig=
 *   - 校验 HMAC 预签名令牌（等价 S3 预签名语义）
 *   - 流式写入本地 uploads/（不整块读入内存）
 *
 * 仅 local 驱动使用；s3 驱动下前端直传对象存储，不经过本路由。
 */

export const runtime = 'nodejs';

class UploadSizeMismatchError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super('upload size mismatch');
  }
}

function enforceExactByteSize(expected: number): Transform {
  let actual = 0;
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback): void {
      actual += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (actual > expected) {
        callback(new UploadSizeMismatchError(expected, actual));
        return;
      }
      callback(null, chunk);
    },
    flush(callback): void {
      callback(actual === expected ? undefined : new UploadSizeMismatchError(expected, actual));
    },
  });
}

export async function PUT(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') ?? '';
  const sig = searchParams.get('sig') ?? '';
  const expires = Number(searchParams.get('expires'));

  if (
    !key ||
    !sig ||
    !Number.isFinite(expires) ||
    !verifyStorageToken('put', key, sig, expires)
  ) {
    return fail(ErrorCode.FORBIDDEN, '上传地址无效或已过期', HttpStatus.FORBIDDEN);
  }

  if (!request.body) {
    return fail(ErrorCode.VALIDATION_FAILED, '请求体为空', HttpStatus.BAD_REQUEST);
  }

  const content = await prisma.learningContent.findFirst({
    where: { storageKey: key },
    select: { fileSizeBytes: true },
  });
  if (!content) {
    return fail(ErrorCode.FORBIDDEN, '上传地址无效或已过期', HttpStatus.FORBIDDEN);
  }

  const expectedSize = Number(content.fileSizeBytes);
  const declaredContentLength = request.headers.get('content-length');
  const contentLength = declaredContentLength === null ? null : Number(declaredContentLength);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength !== expectedSize) {
    return fail(
      ErrorCode.UPLOAD_SIZE_MISMATCH,
      '上传字节数与申报不一致，请重新选择文件',
      HttpStatus.CONFLICT,
      { expected: expectedSize, actual: contentLength },
    );
  }

  const contentType = request.headers.get('content-type') ?? undefined;
  const storage = getStorage();
  try {
    const body = Readable.fromWeb(
      request.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    await storage.putObject(key, body.pipe(enforceExactByteSize(expectedSize)), { contentType });
  } catch (err) {
    if (err instanceof UploadSizeMismatchError) {
      await storage.deleteObject(key).catch(() => undefined);
      return fail(
        ErrorCode.UPLOAD_SIZE_MISMATCH,
        '上传字节数与申报不一致，请重新选择文件',
        HttpStatus.CONFLICT,
        { expected: err.expected, actual: err.actual },
      );
    }
    if (err instanceof StorageError) {
      return fail(
        ErrorCode.STORAGE_UNAVAILABLE,
        '存储写入失败',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw err;
  }

  return new Response(null, { status: 200 });
}
