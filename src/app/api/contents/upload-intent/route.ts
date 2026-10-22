import { ContentStatus, ContentType } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { assertOwnership } from '@/lib/auth/ownership';
import { withAuth } from '@/lib/auth/middleware';
import { defaultTitleFromFileName, validateUpload, ContentFormatLimits } from '@/lib/domain/content-format';
import { prisma } from '@/lib/prisma';
import { buildContentKey, getStorage, StorageError } from '@/lib/storage';

/**
 * 申请上传预签名（tasks.md §3.2）
 * ------------------------------------------------------------
 * POST /api/contents/upload-intent
 *   1. 限流（按用户）
 *   2. zod 校验入参
 *   3. 类型 / 格式 / 大小校验（视频 ≤2GB；文档 ≤50MB）
 *   4. 预创建 status=待导入 内容记录，生成 storageKey
 *   5. 签发预签名直传 URL（local 驱动为 HMAC 模拟，s3 驱动为真实预签名）
 *
 * 异常映射：UNSUPPORTED_FORMAT(400) / FILE_TOO_LARGE(400) / STORAGE_UNAVAILABLE(503)
 * 契约见 spec/03-ARCHITECTURE.md §2.2.2。
 */

const schema = z.object({
  contentId: z.string().min(1).optional(),
  contentType: z.enum(['video', 'document']),
  fileName: z.string().min(1, '文件名不能为空').max(255, '文件名过长'),
  fileSize: z.number().int('文件大小必须为整数').positive('文件大小必须为正数'),
  mimeType: z.string().min(1, '缺少 MIME 类型').max(255),
});

export const POST = withAuth(async (request: NextRequest, { user }) => {
  const limited = await rateLimit(
    `upload-intent:${user.id}`,
    RateLimitPolicy.default.limit,
    RateLimitPolicy.default.windowMs,
  );
  if (!limited.allowed) {
    const response = fail(
      ErrorCode.RATE_LIMITED,
      '操作过于频繁，请稍后再试',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfter: limited.retryAfter },
    );
    response.headers.set('Retry-After', String(limited.retryAfter));
    return response;
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const { contentType, fileName, fileSize, mimeType } = parsed.data;
  const validation = validateUpload(contentType, fileName, fileSize);
  if (!validation.ok) {
    if (validation.reason === 'UNSUPPORTED_FORMAT') {
      return fail(
        ErrorCode.UNSUPPORTED_FORMAT,
        '不支持的文件格式',
        HttpStatus.BAD_REQUEST,
        { contentType, fileName },
      );
    }
    return fail(
      ErrorCode.FILE_TOO_LARGE,
      '文件超出大小限制',
      HttpStatus.BAD_REQUEST,
      { contentType, maxBytes: ContentFormatLimits[contentType].maxBytes },
    );
  }

  const contentTypeEnum =
    contentType === 'video' ? ContentType.VIDEO : ContentType.DOCUMENT;

    let reusable: Awaited<ReturnType<typeof prisma.learningContent.findUnique>> = null;
  if (parsed.data.contentId) {
    reusable = await prisma.learningContent.findUnique({ where: { id: parsed.data.contentId } });
    if (!reusable) return fail(ErrorCode.CONTENT_NOT_FOUND, '上传记录不存在，请核对资料列表。', HttpStatus.NOT_FOUND);
    assertOwnership(reusable.ownerId, user);
    if (reusable.status !== ContentStatus.PENDING || reusable.understandingStatus !== 'NONE'
      || await prisma.asyncJob.count({ where: { contentId: reusable.id } }) > 0
      || reusable.contentType !== contentTypeEnum || reusable.fileName !== fileName || reusable.fileSizeBytes !== BigInt(fileSize)) {
      return fail(ErrorCode.IMPORT_IN_PROGRESS, '原上传记录状态或文件已变化，请核对资料列表；未创建重复记录。', HttpStatus.CONFLICT);
    }
    const changed = await prisma.learningContent.updateMany({ where: { id: reusable.id, ownerId: user.id, status: ContentStatus.PENDING, updatedAt: reusable.updatedAt }, data: { updatedAt: new Date() } });
    if (changed.count !== 1) return fail(ErrorCode.IMPORT_IN_PROGRESS, '上传记录已变化，请核对后重试。', HttpStatus.CONFLICT);
  }
  const content = reusable ?? await prisma.$transaction(async (tx) => {
    const created = await tx.learningContent.create({
      data: {
        ownerId: user.id,
        contentType: contentTypeEnum,
        title: defaultTitleFromFileName(fileName),
        fileName,
        format: validation.format,
        fileSizeBytes: BigInt(fileSize),
        storageKey: '',
        status: ContentStatus.PENDING,
      },
    });
    return tx.learningContent.update({
      where: { id: created.id },
      data: { storageKey: buildContentKey(created.id, fileName) },
    });
  });

  let uploadUrl: string;
  let expiresInSec: number;
  try {
    const storage = getStorage();
    const presigned = await storage.createUploadUrl(content.storageKey, {
      contentType: mimeType,
    });
    // 本地直传走当前网页源，避免 localhost / 127.0.0.1 / 代理入口不一致。
    // S3 签名绑定对象存储地址，必须保持原样。
    const localUrl = storage.driver === 'local' ? new URL(presigned.url) : null;
    uploadUrl = localUrl ? `${localUrl.pathname}${localUrl.search}` : presigned.url;
    expiresInSec = presigned.expiresInSec;
  } catch (err) {
    if (!reusable) {
      // Only this unreturned intent; no upload address reached the client.
      await prisma.learningContent.deleteMany({ where: { id: content.id, ownerId: user.id, status: ContentStatus.PENDING,
        asyncJobs: { none: {} }, notes: { none: {} }, progress: { none: {} }, knowledgePoints: { none: {} },
        flashcards: { none: {} }, exercises: { none: {} }, textBlocks: { none: {} }, transcripts: { none: {} },
        studyPlans: { none: {} }, generatedNote: { is: null } } }).catch((): void => { console.error('[upload-intent] unused intent cleanup incomplete'); });
    }
    // 存储不可用：不暴露内部细节，记录服务端日志（不含密钥）
    // eslint-disable-next-line no-console
    console.error('[upload-intent] storage unavailable', {
      contentId: content.id,
      code: err instanceof StorageError ? err.code : 'UNKNOWN',
    });
    return fail(
      ErrorCode.STORAGE_UNAVAILABLE,
      '存储服务暂时不可用，请稍后重试',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  const response = ok(
    { contentId: content.id, uploadUrl, expiresInSec },
    '上传地址已签发',
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});
