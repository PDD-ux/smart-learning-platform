import { describe, expect, it } from 'vitest';

import { fail, HttpStatus, ok } from '@/lib/api/response';

describe('unified API responses', () => {
  it('wraps successful data and timestamp in the stable envelope', async () => {
    const response = ok({ id: 'c1' }, 'loaded');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, data: { id: 'c1' }, message: 'loaded' });
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it('wraps errors with code, message, status and optional details', async () => {
    const response = fail('VALIDATION_FAILED', 'invalid', HttpStatus.BAD_REQUEST, { field: ['required'] });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'invalid', details: { field: ['required'] } },
    });
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });
});
