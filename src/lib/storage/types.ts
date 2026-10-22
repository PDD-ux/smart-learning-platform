import type { Readable } from 'node:stream';

export type StorageDriver = 'local' | 's3';

export type ByteRange = { start: number; end?: number };

export type PresignResult = {
  url: string;
  method: 'PUT' | 'GET';
  expiresInSec: number;
  headers: Record<string, string>;
};

export type ReadResult = {
  stream: Readable;
  contentLength: number;
  contentType: string;
  acceptRanges: true;
  /** 形如 `bytes 0-99/1000`，仅 Range 读取时返回 */
  contentRange?: string;
};

export type ObjectStat = {
  size: number;
  contentType: string;
};

export type DeleteManyResult = {
  deleted: number;
  failed: string[];
};

export type StorageErrorCode =
  | 'INVALID_KEY'
  | 'NOT_FOUND'
  | 'RANGE_NOT_SATISFIABLE'
  | 'UNAVAILABLE';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export interface StorageClient {
  readonly driver: StorageDriver;
  /** Immutable classroom files: must never replace an existing object's bytes. */
  putObjectIfAbsent?(key: string, data: Buffer, contentType: string): Promise<boolean>;
  createUploadUrl(
    key: string,
    opts?: { contentType?: string; expiresInSec?: number },
  ): Promise<PresignResult>;
  createReadUrl(
    key: string,
    opts?: { expiresInSec?: number; downloadFileName?: string },
  ): Promise<PresignResult>;
  putObject(
    key: string,
    data: Buffer | Readable,
    opts?: { contentType?: string; contentLength?: number },
  ): Promise<void>;
  getObject(key: string, range?: ByteRange): Promise<ReadResult>;
  statObject(key: string): Promise<ObjectStat | null>;
  deleteObject(key: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<DeleteManyResult>;
  /** 按前缀删除全部对象（失败清理 / 级联删除 / 关键帧残留） */
  deletePrefix(prefix: string): Promise<{ deleted: number }>;
  /** local 驱动：直接返回本地绝对路径（供 ffprobe/ffmpeg 就地读取）；s3 驱动不实现 */
  localFilePath?(key: string): string | null;
}
