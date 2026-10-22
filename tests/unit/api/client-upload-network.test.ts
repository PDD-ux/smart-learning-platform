import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, uploadToPresignedUrl } from '@/services/api';

const request = vi.fn();
beforeEach((): void => { window.localStorage.clear(); request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach((): void => { vi.unstubAllGlobals(); });

it('explains failed upload connections without exposing a signed URL or retrying', async (): Promise<void> => {
  request.mockRejectedValue(new TypeError('Failed to fetch https://storage.invalid/?sig=private'));
  await expect(uploadToPresignedUrl('https://storage.invalid/?sig=private', new File(['pdf'], 'lesson.pdf')))
    .rejects.toMatchObject({ status: 0, code: 'UPLOAD_NETWORK_UNAVAILABLE', message: expect.stringContaining('无法连接上传服务') });
  expect(request).toHaveBeenCalledTimes(1);
});

it('explains website connection failure before upload intent, without replaying writes', async (): Promise<void> => {
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(apiRequest('/api/contents/upload-intent', { method: 'POST', body: {} }))
    .rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves cancellation errors', async (): Promise<void> => {
  const cancellation = new DOMException('Cancelled', 'AbortError');
  request.mockRejectedValue(cancellation);
  await expect(uploadToPresignedUrl('/api/storage/upload', new File(['pdf'], 'lesson.pdf'))).rejects.toBe(cancellation);
});

it('keeps HTTP failures separate from connection failures', async (): Promise<void> => {
  request.mockResolvedValue(new Response(null, { status: 403 }));
  await expect(uploadToPresignedUrl('/api/storage/upload', new File(['pdf'], 'lesson.pdf')))
    .rejects.toMatchObject({ status: 403, code: 'UPLOAD_FAILED' });
});
