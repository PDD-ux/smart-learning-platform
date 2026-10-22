import { randomUUID } from 'node:crypto';

import { getStorage, type StorageClient } from '@/lib/storage';
import { encryptEnrollmentPhoto, type EncryptedFaceData } from './crypto';

export const FACE_ENROLLMENT_PHOTO_TTL_DAYS = 30;

export type StoredEnrollmentPhoto = {
  key: string;
  expiresAt: Date;
  encryptionIv: Buffer;
  authTag: Buffer;
  keyId: string;
};

function assertUserId(userId: string): void {
  if (!userId.trim() || userId.includes('/') || userId.includes('\\')) {
    throw new Error('invalid face enrollment user id');
  }
}

export function buildEnrollmentPhotoKey(userId: string, objectId: string = randomUUID()): string {
  assertUserId(userId);
  return `face-enrollment/${userId}/${objectId}.bin`;
}

export function enrollmentPhotoExpiresAt(now: Date = new Date()): Date {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + FACE_ENROLLMENT_PHOTO_TTL_DAYS);
  return expiresAt;
}

/**
 * 将已加密照片直接写入私有对象存储。此模块不生成读取 URL，也不记录对象键。
 */
export async function storeEncryptedEnrollmentPhoto(
  userId: string,
  photo: Buffer,
  options: { storage?: StorageClient; now?: Date } = {},
): Promise<StoredEnrollmentPhoto> {
  const encrypted: EncryptedFaceData = encryptEnrollmentPhoto(photo);
  const key = buildEnrollmentPhotoKey(userId);
  const expiresAt = enrollmentPhotoExpiresAt(options.now);
  const storage = options.storage ?? getStorage();
  await storage.putObject(key, encrypted.ciphertext, { contentType: 'application/octet-stream' });
  return {
    key,
    expiresAt,
    encryptionIv: encrypted.iv,
    authTag: encrypted.authTag,
    keyId: encrypted.keyId,
  };
}

/** 删除私有照片对象；local/S3 驱动均为幂等删除。 */
export async function deleteEnrollmentPhoto(
  key: string,
  storage: StorageClient = getStorage(),
): Promise<void> {
  if (!key.startsWith('face-enrollment/')) {
    throw new Error('refuse to delete a non-face enrollment object');
  }
  await storage.deleteObject(key);
}
