import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/services/api';

const request = vi.fn();
beforeEach(() => { window.localStorage.clear(); vi.stubGlobal('fetch', request); request.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
function response(data: unknown): Response { return new Response(JSON.stringify({ success: true, data }), { status: 200 }); }
it('loads older contents beyond the first 50, preserving the type filter', async () => {
  request.mockResolvedValueOnce(response({ total: 51, items: Array.from({ length: 50 }, (_, i) => ({ contentId: 'c' + i })) }))
    .mockResolvedValueOnce(response({ total: 51, items: [{ contentId: 'older' }] }));
  const result = await api.contents('video');
  expect(result.items).toHaveLength(51);
  expect(request.mock.calls[1][0]).toBe('/api/contents?pageSize=50&type=video&page=2');
});
it('loads all due cards and preserves the selected content', async () => {
  request.mockResolvedValueOnce(response({ total: 51, items: Array.from({ length: 50 }, (_, i) => ({ flashcardId: 'f' + i })) }))
    .mockResolvedValueOnce(response({ total: 51, items: [{ flashcardId: 'last' }] }));
  expect((await api.flashcards(true, 'a&b')).items).toHaveLength(51);
  expect(request.mock.calls[1][0]).toBe('/api/flashcards?due=true&pageSize=50&contentId=a%26b&page=2');
});
it('fails explicitly when pagination stops advancing instead of looping', async () => {
  request.mockImplementation(async () => response({ total: 1000, items: [{ contentId: 'repeated' }] }));
  await expect(api.contents()).rejects.toMatchObject({ code: 'LIST_CHANGED' });
  expect(request).toHaveBeenCalledTimes(2);
});
