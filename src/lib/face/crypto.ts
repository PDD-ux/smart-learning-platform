import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AES_256_GCM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type FaceEncryptionPurpose = 'template' | 'enrollment-photo';

export type EncryptedFaceData = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
};

export class FaceCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceCryptoError';
  }
}

function keyEnvironmentName(purpose: FaceEncryptionPurpose): string {
  return purpose === 'template'
    ? 'FACE_TEMPLATE_ENCRYPTION_KEY'
    : 'FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY';
}

function keyIdEnvironmentName(purpose: FaceEncryptionPurpose): string {
  return purpose === 'template'
    ? 'FACE_TEMPLATE_ENCRYPTION_KEY_ID'
    : 'FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY_ID';
}

function decodeAesKey(raw: string, environmentName: string): Buffer {
  const compact = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(compact)
    ? Buffer.from(compact, 'hex')
    : Buffer.from(compact, 'base64');

  const normalized = key.toString('base64').replace(/=+$/, '');
  const supplied = compact.replace(/=+$/, '');
  const isCanonicalBase64 = normalized === supplied;
  const isRepeatedByte = key.length === KEY_BYTES && key.every((byte: number) => byte === key[0]);

  if (key.length !== KEY_BYTES || (!/^[0-9a-f]{64}$/i.test(compact) && !isCanonicalBase64) || isRepeatedByte) {
    throw new FaceCryptoError(
      `${environmentName} 必须是随机生成的 32 字节 Base64 或 64 位十六进制 AES-256 密钥`,
    );
  }
  return key;
}

function encryptionKey(purpose: FaceEncryptionPurpose): Buffer {
  const environmentName = keyEnvironmentName(purpose);
  const value = process.env[environmentName]?.trim();
  if (!value) {
    throw new FaceCryptoError(`${environmentName} 未配置`);
  }
  return decodeAesKey(value, environmentName);
}

function encryptionKeyId(purpose: FaceEncryptionPurpose): string {
  const environmentName = keyIdEnvironmentName(purpose);
  const value = process.env[environmentName]?.trim();
  if (!value) {
    throw new FaceCryptoError(`${environmentName} 未配置`);
  }
  return value;
}

function encrypt(plaintext: Buffer, purpose: FaceEncryptionPurpose): EncryptedFaceData {
  const key = encryptionKey(purpose);
  const iv = randomBytes(IV_BYTES);
  const input = Buffer.from(plaintext);
  try {
    const cipher = createCipheriv(AES_256_GCM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId: encryptionKeyId(purpose) };
  } finally {
    key.fill(0);
    input.fill(0);
  }
}

function decrypt(data: EncryptedFaceData, purpose: FaceEncryptionPurpose): Buffer {
  const key = encryptionKey(purpose);
  try {
    const decipher = createDecipheriv(AES_256_GCM, key, data.iv);
    decipher.setAuthTag(data.authTag);
    return Buffer.concat([decipher.update(data.ciphertext), decipher.final()]);
  } finally {
    key.fill(0);
  }
}

/** 加密固定模型生成的向量；调用方不得记录或回传明文。 */
export function encryptFaceTemplateVector(vector: Buffer): EncryptedFaceData {
  return encrypt(vector, 'template');
}

/** 仅供服务端验证时瞬时解密，不得将返回值持久化或写入日志。 */
export function decryptFaceTemplateVector(data: EncryptedFaceData): Buffer {
  return decrypt(data, 'template');
}

/** 首次录入照片的独立加密域，与向量密钥绝不共用。 */
export function encryptEnrollmentPhoto(photo: Buffer): EncryptedFaceData {
  return encrypt(photo, 'enrollment-photo');
}

/** 仅用于受控恢复/轮换流程；普通业务路径不得调用。 */
export function decryptEnrollmentPhoto(data: EncryptedFaceData): Buffer {
  return decrypt(data, 'enrollment-photo');
}
