import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, setAccessToken, clearAccessToken } from '@/services/api';
import { subscribeProfileUpdates } from '@/services/profile-updates';
let unsubscribe: (() => void) | undefined;
const result = { xpGain: 10, newXpTotal: 17, newStreak: 1, nextReviewAt: '2026-10-14', levelUp: null, unlockedAchievements: [] };
function response(status = 200): Response {
  return new Response(JSON.stringify(status === 200 ? { success:true,data:result } : { success:false,error:{code:'UNAVAILABLE',message:'失败'} }), { status, headers:{'content-type':'application/json'} });
}
beforeEach((): void => { setAccessToken('fixture-only'); });
afterEach((): void => { unsubscribe?.(); unsubscribe=undefined; clearAccessToken(); vi.unstubAllGlobals(); });
it('notifies only after a successful server review and preserves its result', async (): Promise<void> => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish=resolve; })));
  const listener=vi.fn(); unsubscribe=subscribeProfileUpdates(listener);
  const request=api.review('temporary-card',3);
  expect(listener).not.toHaveBeenCalled(); finish(response());
  expect(await request).toEqual(result); expect(listener).toHaveBeenCalledTimes(1);
});
it('does not notify or replay a failed review', async (): Promise<void> => {
  const fetcher=vi.fn().mockResolvedValue(response(503)); vi.stubGlobal('fetch',fetcher);
  const listener=vi.fn(); unsubscribe=subscribeProfileUpdates(listener);
  await expect(api.review('temporary-card',3)).rejects.toThrow('失败');
  expect(listener).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not publish an old-account response after a session change', async (): Promise<void> => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish=resolve; })));
  const listener=vi.fn(); unsubscribe=subscribeProfileUpdates(listener);
  const request=api.review('temporary-card',3); setAccessToken('different-fixture-session'); finish(response());
  await expect(request).rejects.toThrow('登录状态已变化'); expect(listener).not.toHaveBeenCalled();
});
