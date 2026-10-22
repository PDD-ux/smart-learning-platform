import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/auth/ownership';
import {
  assertContentTransition,
  canTransition,
  isTerminal,
} from '@/lib/domain/content-state-machine';

/**
 * 内容导入状态机 单测（tasks.md §3.2）
 */

describe('canTransition', () => {
  it('allows the documented import transitions', () => {
    expect(canTransition('PENDING', 'UPLOADING')).toBe(true);
    expect(canTransition('PENDING', 'PARSING')).toBe(true);
    expect(canTransition('UPLOADING', 'PARSING')).toBe(true);
    expect(canTransition('PARSING', 'READY')).toBe(true);
    expect(canTransition('PARSING', 'FAILED')).toBe(true);
    expect(canTransition('UPLOADING', 'PENDING')).toBe(true);
    expect(canTransition('FAILED', 'PARSING')).toBe(true);
    expect(canTransition('FAILED', 'PENDING')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('READY', 'PARSING')).toBe(false);
    expect(canTransition('READY', 'FAILED')).toBe(false);
    expect(canTransition('PARSING', 'PARSING')).toBe(false);
    expect(canTransition('PENDING', 'READY')).toBe(false);
    expect(canTransition('FAILED', 'READY')).toBe(false);
  });
});

describe('assertContentTransition', () => {
  it('passes for legal transitions', () => {
    expect(() => assertContentTransition('PENDING', 'PARSING')).not.toThrow();
  });

  it('throws IMPORT_IN_PROGRESS with from/to details', () => {
    try {
      assertContentTransition('READY', 'PARSING');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('IMPORT_IN_PROGRESS');
      expect(apiErr.status).toBe(409);
      expect(apiErr.details).toEqual({ from: 'READY', to: 'PARSING' });
    }
  });
});

describe('isTerminal', () => {
  it('treats READY as terminal only', () => {
    expect(isTerminal('READY')).toBe(true);
    expect(isTerminal('FAILED')).toBe(false);
    expect(isTerminal('PARSING')).toBe(false);
  });
});
