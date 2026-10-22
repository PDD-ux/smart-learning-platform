const MAX_CAPTURE_BYTES = 1_024 * 1_024;
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type FaceCapture = {
  mimeType: 'image/jpeg' | 'image/png';
  bytes: Buffer;
};

export class FaceCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceCaptureError';
  }
}

function hasPrefix(bytes: Buffer, prefix: Buffer): boolean {
  return bytes.length >= prefix.length && bytes.subarray(0, prefix.length).equals(prefix);
}

function decodeBase64(base64: string): Buffer {
  const normalized = base64.replace(/\s/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new FaceCaptureError('摄像头画面编码无效');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (!bytes.length || bytes.toString('base64') !== normalized) {
    throw new FaceCaptureError('摄像头画面编码无效');
  }
  return bytes;
}

/**
 * 只接受当前请求提交的 PNG/JPEG data URL。解析后的 Buffer 由调用方在 finally 中清零。
 */
export function parseFaceCapture(value: string): FaceCapture {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) throw new FaceCaptureError('仅支持 JPEG 或 PNG 摄像头画面');
  const mimeType = match[1] as FaceCapture['mimeType'];
  const bytes = decodeBase64(match[2]);
  if (bytes.length > MAX_CAPTURE_BYTES) {
    bytes.fill(0);
    throw new FaceCaptureError('单张摄像头画面不能超过 1MiB');
  }
  const signatureValid = mimeType === 'image/jpeg'
    ? hasPrefix(bytes, JPEG_SIGNATURE)
    : hasPrefix(bytes, PNG_SIGNATURE);
  if (!signatureValid) {
    bytes.fill(0);
    throw new FaceCaptureError('摄像头画面格式与内容不匹配');
  }
  return { mimeType, bytes };
}

export function disposeFaceCaptures(captures: readonly FaceCapture[]): void {
  for (const capture of captures) capture.bytes.fill(0);
}
