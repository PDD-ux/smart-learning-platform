import { describe, expect, it } from 'vitest';
import { resolveContentSelection } from '@/lib/domain/content-selection';

describe('content scope from navigation', (): void => {
  const contents = [{ contentId: 'first' }, { contentId: 'second' }];
  it('selects the requested authorized item instead of the first item', (): void => {
    expect(resolveContentSelection(contents, 'second', true)).toEqual({ contentId: 'second', error: '' });
  });
  it('keeps an invalid or ambiguous explicit request unselected', (): void => {
    for (const value of ['foreign', '', ['first', 'second'], 'x'.repeat(129)]) {
      const result = resolveContentSelection(contents, value, true);
      expect(result.contentId).toBe(''); expect(result.error).not.toBe('');
    }
  });
  it('uses the existing default only when no explicit request exists', (): void => {
    expect(resolveContentSelection(contents, undefined, true).contentId).toBe('first');
    expect(resolveContentSelection(contents, undefined).contentId).toBe('');
    expect(resolveContentSelection([], undefined, true)).toEqual({ contentId: '', error: '' });
  });
});
