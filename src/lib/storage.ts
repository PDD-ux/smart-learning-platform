/**
 * 对象存储兼容门面。
 * 实现按职责拆分在 `src/lib/storage/`；保留该入口以兼容现有应用、脚本与测试导入。
 */
export {
  StorageError,
  type ByteRange,
  type DeleteManyResult,
  type ObjectStat,
  type PresignResult,
  type ReadResult,
  type StorageClient,
  type StorageDriver,
  type StorageErrorCode,
} from './storage/types';
export { getStorageDriver } from './storage/config';
export {
  buildContentKey,
  buildCoverKey,
  buildFrameKey,
  contentKeyPrefix,
  contentTypeFromKey,
  coverKeyPrefix,
  frameKeyPrefix,
} from './storage/keys';
export {
  signStorageToken,
  verifyStorageToken,
  type StorageTokenAction,
} from './storage/tokens';
export { LocalStorageClient } from './storage/local-client';
export { S3StorageClient } from './storage/s3-client';
export { __resetStorageForTest, cleanupContentObjects, getStorage } from './storage/index';
