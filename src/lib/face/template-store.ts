import { prisma } from '@/lib/prisma';
import { getStorage, type StorageClient } from '@/lib/storage';
import { encryptFaceTemplateVector } from './crypto';
import {
  deleteEnrollmentPhoto,
  storeEncryptedEnrollmentPhoto,
  type StoredEnrollmentPhoto,
} from './enrollment-photo';

type ExistingTemplate = { id: string; enrollmentPhotoKey: string | null };

type FaceTemplateData = {
  encryptedVector: Buffer;
  encryptionIv: Buffer;
  authTag: Buffer;
  keyId: string;
  enrollmentPhotoKey: string;
  photoExpiresAt: Date;
  photoEncryptionIv: Buffer;
  photoAuthTag: Buffer;
  photoKeyId: string;
  modelVersion: string;
  consentVersion: string;
  enrolledAt: Date;
};

export interface FaceTemplateRepository {
  faceTemplate: {
    findUnique(args: { where: { userId: string }; select: { id: true; enrollmentPhotoKey: true } }): Promise<ExistingTemplate | null>;
    upsert(args: {
      where: { userId: string };
      create: FaceTemplateData & { userId: string };
      update: FaceTemplateData;
    }): Promise<unknown>;
    delete(args: { where: { userId: string } }): Promise<unknown>;
    findMany(args: {
      where: { photoExpiresAt: { lte: Date }; enrollmentPhotoKey: { not: null } };
      select: { id: true; enrollmentPhotoKey: true };
      take: number;
    }): Promise<ExistingTemplate[]>;
    updateMany(args: {
      where: { id: string; enrollmentPhotoKey: string };
      data: {
        enrollmentPhotoKey: null;
        photoExpiresAt: null;
        photoEncryptionIv: null;
        photoAuthTag: null;
        photoKeyId: null;
      };
    }): Promise<{ count: number }>;
  };
}

export type ReplaceFaceTemplateInput = {
  userId: string;
  vector: Buffer;
  enrollmentPhoto: Buffer;
  modelVersion: string;
  consentVersion: string;
};

export type FacePhotoCleanupResult = {
  scanned: number;
  cleared: number;
  failed: number;
};

function repositoryOrDefault(repository?: FaceTemplateRepository): FaceTemplateRepository {
  return repository ?? (prisma as unknown as FaceTemplateRepository);
}

function toTemplateData(
  input: ReplaceFaceTemplateInput,
  photo: StoredEnrollmentPhoto,
  now: Date,
): FaceTemplateData {
  const vector = encryptFaceTemplateVector(input.vector);
  return {
    encryptedVector: vector.ciphertext,
    encryptionIv: vector.iv,
    authTag: vector.authTag,
    keyId: vector.keyId,
    enrollmentPhotoKey: photo.key,
    photoExpiresAt: photo.expiresAt,
    photoEncryptionIv: photo.encryptionIv,
    photoAuthTag: photo.authTag,
    photoKeyId: photo.keyId,
    modelVersion: input.modelVersion,
    consentVersion: input.consentVersion,
    enrolledAt: now,
  };
}

/**
 * 写入新模板后立即清理旧录入照片。调用方只能在已取得独立授权后调用。
 */
export async function replaceFaceTemplate(
  input: ReplaceFaceTemplateInput,
  options: { repository?: FaceTemplateRepository; storage?: StorageClient; now?: Date } = {},
): Promise<void> {
  const repository = repositoryOrDefault(options.repository);
  const storage = options.storage ?? getStorage();
  const now = options.now ?? new Date();
  const previous = await repository.faceTemplate.findUnique({
    where: { userId: input.userId },
    select: { id: true, enrollmentPhotoKey: true },
  });
  let photo: StoredEnrollmentPhoto | null = null;

  try {
    photo = await storeEncryptedEnrollmentPhoto(input.userId, input.enrollmentPhoto, { storage, now });
    const templateData = toTemplateData(input, photo, now);
    await repository.faceTemplate.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, ...templateData },
      update: templateData,
    });
  } catch (error) {
    if (photo) await deleteEnrollmentPhoto(photo.key, storage).catch(() => undefined);
    throw error;
  }

  if (!photo) {
    throw new Error('face enrollment photo was not stored');
  }

  if (previous?.enrollmentPhotoKey && previous.enrollmentPhotoKey !== photo.key) {
    await deleteEnrollmentPhoto(previous.enrollmentPhotoKey, storage);
  }
}

/** 删除模板前先删除私有照片，确保失败时模板仍可重试清理。 */
export async function deleteFaceTemplate(
  userId: string,
  options: { repository?: FaceTemplateRepository; storage?: StorageClient } = {},
): Promise<boolean> {
  const repository = repositoryOrDefault(options.repository);
  const storage = options.storage ?? getStorage();
  const current = await repository.faceTemplate.findUnique({
    where: { userId },
    select: { id: true, enrollmentPhotoKey: true },
  });
  if (!current) return false;
  if (current.enrollmentPhotoKey) await deleteEnrollmentPhoto(current.enrollmentPhotoKey, storage);
  await repository.faceTemplate.delete({ where: { userId } });
  return true;
}

/**
 * 每日调度入口：先删除已过期的私有对象，再清空数据库中的照片定位与加密元数据。
 * 结果只返回计数，避免把用户 ID、对象键或生物数据写入日志。
 */
export async function cleanupExpiredEnrollmentPhotos(
  options: { repository?: FaceTemplateRepository; storage?: StorageClient; now?: Date; batchSize?: number } = {},
): Promise<FacePhotoCleanupResult> {
  const repository = repositoryOrDefault(options.repository);
  const storage = options.storage ?? getStorage();
  const now = options.now ?? new Date();
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500);
  const templates = await repository.faceTemplate.findMany({
    where: { photoExpiresAt: { lte: now }, enrollmentPhotoKey: { not: null } },
    select: { id: true, enrollmentPhotoKey: true },
    take: batchSize,
  });
  let cleared = 0;
  let failed = 0;

  for (const template of templates) {
    if (!template.enrollmentPhotoKey) continue;
    try {
      await deleteEnrollmentPhoto(template.enrollmentPhotoKey, storage);
      const result = await repository.faceTemplate.updateMany({
        where: { id: template.id, enrollmentPhotoKey: template.enrollmentPhotoKey },
        data: {
          enrollmentPhotoKey: null,
          photoExpiresAt: null,
          photoEncryptionIv: null,
          photoAuthTag: null,
          photoKeyId: null,
        },
      });
      cleared += result.count;
    } catch {
      failed += 1;
    }
  }
  return { scanned: templates.length, cleared, failed };
}
