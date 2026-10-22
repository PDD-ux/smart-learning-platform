import '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// 每个测试结束后自动清理 DOM
afterEach(() => {
  cleanup();
});

// 环境变量默认值（避免测试时 NPE）
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
vi.stubEnv('JWT_SECRET', 'test-secret-only-for-unit-tests');