import nextEnv from '@next/env';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

nextEnv.loadEnvConfig(process.cwd());
export default defineConfig({
  resolve: { alias: { '@': resolve('src') } },
  test: { environment: 'node', include: ['scripts/acceptance/queue-reliability-db.test.ts'], fileParallelism: false },
});
