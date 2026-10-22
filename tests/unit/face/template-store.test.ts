import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decryptEnrollmentPhoto,
  decryptFaceTemplateVector,
  encryptEnrollmentPhoto,
  encryptFaceTemplateVector,
  FaceCryptoError,
} from '@/lib/face/crypto';
import {
  deleteEnrollmentPhoto,
  storeEncryptedEnrollmentPhoto,
} from '@/lib/face/enrollment-photo';
import {
  cleanupExpiredEnrollmentPhotos,
  deleteFaceTemplate,
  type FaceTemplateRepository,
} from '@/lib/face/template-store';
import { LocalStorageClient } from '@/lib/storage';

const TEMPLATE_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const PHOTO_KEY = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';

describe('face template security boundary', () => {
  let root: string;
  let storage: LocalStorageClient;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'slp-face-template-'));
    storage = new LocalStorageClient(root);
    vi.stubEnv('FACE_TEMPLATE_ENCRYPTION_KEY', TEMPLATE_KEY);
    vi.stubEnv('FACE_TEMPLATE_ENCRYPTION_KEY_ID', 'template-test-key-v1');
    vi.stubEnv('FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY', PHOTO_KEY);
    vi.stubEnv('FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY_ID', 'photo-test-key-v1');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('uses independent random AES-GCM IVs and round-trips only in server memory', () => {
    const vector = Buffer.from('embedding-bytes');
    const templateOne = encryptFaceTemplateVector(vector);
    const templateTwo = encryptFaceTemplateVector(vector);
    const photo = encryptEnrollmentPhoto(Buffer.from('jpeg-bytes'));

    expect(templateOne.ciphertext).not.toEqual(vector);
    expect(templateOne.iv).not.toEqual(templateTwo.iv);
    expect(templateOne.keyId).toBe('template-test-key-v1');
    expect(photo.keyId).toBe('photo-test-key-v1');
    expect(decryptFaceTemplateVector(templateOne).toString()).toBe('embedding-bytes');
    expect(decryptEnrollmentPhoto(photo).toString()).toBe('jpeg-bytes');
  });

  it('rejects a missing encryption key instead of using a development fallback', () => {
    vi.stubEnv('FACE_TEMPLATE_ENCRYPTION_KEY', '');
    expect(() => encryptFaceTemplateVector(Buffer.from('embedding'))).toThrow(FaceCryptoError);
  });

  it('stores only encrypted enrollment-photo bytes under the private prefix for 30 days', async () => {
    const plaintext = Buffer.from('raw-jpeg-never-in-db');
    const now = new Date('2026-09-24T00:00:00.000Z');
    const stored = await storeEncryptedEnrollmentPhoto('user-1', plaintext, { storage, now });
    const object = await storage.getObject(stored.key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
    const ciphertext = Buffer.concat(chunks);

    expect(stored.key).toMatch(/^face-enrollment\/user-1\//);
    expect(stored.expiresAt.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(ciphertext).not.toEqual(plaintext);
    expect(decryptEnrollmentPhoto({
      ciphertext,
      iv: stored.encryptionIv,
      authTag: stored.authTag,
      keyId: stored.keyId,
    })).toEqual(plaintext);
  });

  it('cleans expired photo objects and clears their database metadata without exposing keys', async () => {
    const expiredKey = 'face-enrollment/user-1/expired.bin';
    await storage.putObject(expiredKey, Buffer.from('ciphertext'));
    const updateCalls: string[] = [];
    const repository = {
      faceTemplate: {
        findMany: async () => [{ id: 'template-1', enrollmentPhotoKey: expiredKey }],
        updateMany: async (args: { where: { id: string; enrollmentPhotoKey: string } }) => {
          updateCalls.push(args.where.id);
          return { count: 1 };
        },
      },
    } as unknown as FaceTemplateRepository;

    const result = await cleanupExpiredEnrollmentPhotos({ repository, storage });

    expect(result).toEqual({ scanned: 1, cleared: 1, failed: 0 });
    expect(updateCalls).toEqual(['template-1']);
    expect(await storage.statObject(expiredKey)).toBeNull();
  });

  it('deletes the private object before hard-deleting a template', async () => {
    const key = 'face-enrollment/user-1/current.bin';
    await storage.putObject(key, Buffer.from('ciphertext'));
    let wasDeleted = false;
    const repository = {
      faceTemplate: {
        findUnique: async () => ({ id: 'template-1', enrollmentPhotoKey: key }),
        delete: async () => {
          wasDeleted = true;
          return {};
        },
      },
    } as unknown as FaceTemplateRepository;

    await expect(deleteFaceTemplate('user-1', { repository, storage })).resolves.toBe(true);
    expect(wasDeleted).toBe(true);
    expect(await storage.statObject(key)).toBeNull();

    await expect(deleteEnrollmentPhoto('contents/user-1/not-face.bin', storage)).rejects.toThrow(
      'refuse to delete a non-face enrollment object',
    );
  });
});
