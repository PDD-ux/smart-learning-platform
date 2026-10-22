/**
 * 内容格式与大小校验（tasks.md §3.2）
 * ------------------------------------------------------------
 * 纯函数模块，供上传申请（upload-intent）、解析 worker 与公网导入复用。
 * 校验规则对齐 spec/03-ARCHITECTURE.md §2.2.2：
 *   - 视频：MP4 / MOV / WEBM / MKV，≤ 2GB
 *   - 文档：PDF / MD / TXT / PNG / JPEG，≤ 50MB
 */

export type ContentTypeValue = 'video' | 'document';

export type UploadFormatRule = {
  /** 允许的扩展名（大写，已归一化） */
  formats: readonly string[];
  maxBytes: number;
};

export const ContentFormatLimits: Record<ContentTypeValue, UploadFormatRule> = {
  video: { formats: ['MP4', 'MOV', 'WEBM', 'MKV'], maxBytes: 2 * 1024 ** 3 },
  document: { formats: ['PDF', 'MD', 'TXT', 'EPUB', 'PNG', 'JPEG'], maxBytes: 50 * 1024 ** 2 },
};

export type UploadValidation =
  | { ok: true; contentType: ContentTypeValue; format: string; maxBytes: number }
  | { ok: false; reason: 'UNSUPPORTED_FORMAT' | 'FILE_TOO_LARGE' };

/** 归一化扩展名：jpg → JPEG（其余转大写） */
function normalizeFormat(ext: string): string {
  const upper = ext.toUpperCase();
  return upper === 'JPG' ? 'JPEG' : upper;
}

/** 从文件名提取归一化格式（无扩展名返回 null） */
export function formatFromFileName(fileName: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? normalizeFormat(match[1]) : null;
}

/** 校验类型 / 格式 / 大小；任一不通过返回对应原因 */
export function validateUpload(
  contentType: ContentTypeValue,
  fileName: string,
  fileSize: number,
): UploadValidation {
  const rule = ContentFormatLimits[contentType];
  const format = formatFromFileName(fileName);
  if (!format || !rule.formats.includes(format)) {
    return { ok: false, reason: 'UNSUPPORTED_FORMAT' };
  }
  if (!Number.isFinite(fileSize) || fileSize > rule.maxBytes) {
    return { ok: false, reason: 'FILE_TOO_LARGE' };
  }
  return { ok: true, contentType, format, maxBytes: rule.maxBytes };
}

/** 由文件名生成默认标题（去扩展名，截断到 1~100） */
export function defaultTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const title = base.slice(0, 100);
  return title.length > 0 ? title : '未命名内容';
}
