import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

import { boolEnv, DEFAULT_CONTENT_TYPE, presignedExpiresSec, s3Bucket } from './config';
import { contentTypeFromKey } from './keys';
import {
  type ByteRange,
  type DeleteManyResult,
  type ObjectStat,
  type PresignResult,
  type ReadResult,
  type StorageClient,
} from './types';

function createS3Client(endpoint: string | undefined = process.env.S3_ENDPOINT): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: endpoint || undefined,
    forcePathStyle: boolEnv('S3_FORCE_PATH_STYLE', true),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

/**
 * 上传/播放预签名地址会交给浏览器访问，容器内部地址（例如 `minio`）对浏览器不可见。
 * 未单独配置时回退内部地址，兼容云对象存储与旧环境。
 */
function createS3PresignClient(): S3Client {
  return createS3Client(process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.S3_ENDPOINT);
}

export class S3StorageClient implements StorageClient {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor(client: S3Client = createS3Client(), presignClient: S3Client = createS3PresignClient()) {
    this.client = client;
    this.presignClient = presignClient;
  }

  async putObjectIfAbsent(key: string, data: Buffer, contentType: string): Promise<boolean> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: s3Bucket(),
          Key: key,
          Body: data,
          ContentType: contentType,
          ContentLength: data.byteLength,
          IfNoneMatch: '*',
        }),
      );
      return true;
    } catch (reason) {
      if (
        typeof reason === 'object' &&
        reason !== null &&
        '$metadata' in reason &&
        (reason as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412
      ) {
        return false;
      }
      throw reason;
    }
  }

  async createUploadUrl(
    key: string,
    opts: { contentType?: string; expiresInSec?: number } = {},
  ): Promise<PresignResult> {
    const command = new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      ContentType: opts.contentType ?? DEFAULT_CONTENT_TYPE,
    });
    const url = await getSignedUrl(this.presignClient, command, {
      expiresIn: opts.expiresInSec ?? presignedExpiresSec(),
    });
    return {
      url,
      method: 'PUT',
      expiresInSec: opts.expiresInSec ?? presignedExpiresSec(),
      headers: { 'Content-Type': opts.contentType ?? DEFAULT_CONTENT_TYPE },
    };
  }

  async createReadUrl(
    key: string,
    opts: { expiresInSec?: number; downloadFileName?: string } = {},
  ): Promise<PresignResult> {
    const command = new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      ResponseContentDisposition: opts.downloadFileName
        ? `attachment; filename="${opts.downloadFileName}"`
        : undefined,
    });
    const url = await getSignedUrl(this.presignClient, command, {
      expiresIn: opts.expiresInSec ?? presignedExpiresSec(),
    });
    return { url, method: 'GET', expiresInSec: opts.expiresInSec ?? presignedExpiresSec(), headers: {} };
  }

  async putObject(
    key: string,
    data: Buffer | Readable,
    opts: { contentType?: string; contentLength?: number } = {},
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: key,
        Body: data,
        ContentType: opts.contentType ?? DEFAULT_CONTENT_TYPE,
        ContentLength: opts.contentLength,
      }),
    );
  }

  async getObject(key: string, range?: ByteRange): Promise<ReadResult> {
    const rangeHeader = range ? `bytes=${range.start}-${range.end ?? ''}` : undefined;
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: s3Bucket(), Key: key, Range: rangeHeader }),
    );
    return {
      stream: out.Body as Readable,
      contentLength: out.ContentLength ?? 0,
      contentType: out.ContentType ?? contentTypeFromKey(key),
      acceptRanges: true,
      contentRange: out.ContentRange,
    };
  }

  async statObject(key: string): Promise<ObjectStat | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? contentTypeFromKey(key) };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }));
  }

  async deleteObjects(keys: string[]): Promise<DeleteManyResult> {
    if (keys.length === 0) return { deleted: 0, failed: [] };
    const out = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: s3Bucket(),
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const failed = (out.Errors ?? []).map((error) => error.Key ?? '').filter(Boolean);
    return { deleted: keys.length - failed.length, failed };
  }

  async deletePrefix(prefix: string): Promise<{ deleted: number }> {
    let token: string | undefined;
    let deleted = 0;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: s3Bucket(), Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key));
      if (keys.length > 0) {
        const result = await this.deleteObjects(keys);
        deleted += result.deleted;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return { deleted };
  }
}
