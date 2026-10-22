import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('Docker Compose deployment contract', () => {
  it('installs and checks both video tools in worker and web image stages', (): void => {
    const dockerfile = readProjectFile('Dockerfile');
    for (const stage of ['builder', 'runner']) {
      const section = dockerfile.split(` AS ${stage}`)[1]?.split('\nFROM ')[0] ?? '';
      expect(section).toMatch(/apk add[^\n]*\bffmpeg\b/);
      expect(section).toContain('ffmpeg -version && ffprobe -version');
    }
    expect(dockerfile).toContain('FROM builder AS worker');
  });
  it('starts an isolated BullMQ worker with the production queue driver', () => {
    const compose = readProjectFile('docker-compose.yml');
    const dockerfile = readProjectFile('Dockerfile');
    const worker = readProjectFile('src/worker.ts');

    expect(compose).toContain('QUEUE_DRIVER: bullmq');
    expect(compose).toContain('\n  worker:\n');
    expect(compose).toContain('target: worker');
    expect(dockerfile).toContain('FROM builder AS worker');
    expect(dockerfile).toContain('CMD ["./node_modules/.bin/tsx", "src/worker.ts"]');
    expect(dockerfile).toContain('USER nextjs');
    expect(worker).toContain("import { bootstrapWorkers } from '@/lib/jobs/workers'");
    expect(worker).toContain('bootstrapWorkers();');
  });

  it('uses compatible internal and browser-facing MinIO endpoints', () => {
    const compose = readProjectFile('docker-compose.yml');
    const environmentTemplate = readProjectFile('.env.example');
    const storage = readProjectFile('src/lib/storage.ts');
    const s3Storage = readProjectFile('src/lib/storage/s3-client.ts');

    expect(compose).toContain('STORAGE_DRIVER: s3');
    expect(compose).toContain('S3_ENDPOINT: http://minio:9000');
    expect(compose).toContain('S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:-http://localhost:${MINIO_PORT:-9000}}');
    expect(compose).toContain('S3_BUCKET: slp-learning');
    expect(compose).not.toContain('S3_BUCKET_VIDEOS');
    expect(compose).not.toContain('S3_BUCKET_DOCUMENTS');
    expect(environmentTemplate).toContain('S3_PUBLIC_ENDPOINT=""');
    expect(storage).toContain("export { S3StorageClient } from './storage/s3-client'");
    expect(s3Storage).toContain('process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.S3_ENDPOINT');
  });

  it('protects Redis health checks and initializes the private bucket CORS policy', () => {
    const compose = readProjectFile('docker-compose.yml');

    expect(compose).toContain('redis-cli --no-auth-warning -a ');
    expect(compose).toContain('$$REDIS_PASSWORD');
    expect(compose).toContain('mc mb --ignore-existing local/slp-learning');
    expect(compose).toContain('mc anonymous set none local/slp-learning');
    expect(compose).toContain('mc cors set local/slp-learning /tmp/cors.json');
  });

  it('checks the existing Next.js route rather than a missing health endpoint', () => {
    const dockerfile = readProjectFile('Dockerfile');
    const compose = readProjectFile('docker-compose.yml');
    const nextConfig = readProjectFile('next.config.mjs');

    expect(dockerfile).toContain('http://localhost:3000/');
    expect(dockerfile).not.toContain('/api/health');
    expect(compose).toContain('http://localhost:3000/');
    expect(nextConfig).toContain("output: 'standalone'");
  });
});
