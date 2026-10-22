import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), chunk: vi.fn(), claim: vi.fn(), chunks: vi.fn(), upsert: vi.fn(), update: vi.fn(), run: vi.fn(), extract: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  liveSession: { findUnique: mocks.session, updateMany: mocks.claim }, liveChunk: { findUnique: mocks.chunk, findMany: mocks.chunks, upsert: mocks.upsert, updateMany: mocks.update, update: mocks.update },
  $transaction: async (fn: (tx: unknown) => Promise<void>): Promise<void> => fn({ liveSession: { updateMany: mocks.claim }, liveChunk: { update: mocks.update, updateMany: mocks.update } }),
} }));
vi.mock('@/lib/ai/asr-live', () => ({ liveAsrRuntime: (): { run: typeof mocks.run } => ({ run: mocks.run }) }));
vi.mock('@/lib/ai/spark', async (original) => ({ ...await original<typeof import('@/lib/ai/spark')>(), extractJson: mocks.extract }));
import { addLiveChunk, ownedLiveSession, finishLive, liveHighlights } from '@/lib/live-notes';

const session = { id: 's1', ownerId: 'u1', title: '课堂', state: 'LIVE', nextSequence: 0, totalSamples: 0, processingSequence: null, processingToken: null, processingStartedAt: null, highlights: [], lastHighlightSequence: -1, highlightVersion: 0, summaryMarkdown: null, createdAt: new Date() };
const audio = Buffer.alloc(3200).toString('base64');
describe('live note ownership, failure and ordering', () => {
  beforeEach((): void => { vi.resetAllMocks(); mocks.session.mockResolvedValue(session); mocks.chunk.mockResolvedValue(null); mocks.claim.mockResolvedValue({ count: 1 }); mocks.chunks.mockResolvedValue([]); });
  it('rejects another owner before ASR or model work', async (): Promise<void> => {
    await expect(ownedLiveSession('s1', 'u2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(addLiveChunk('s1', 'u2', 0, audio)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rejects out-of-order and busy claims before ASR', async (): Promise<void> => {
    await expect(addLiveChunk('s1', 'u1', 1, audio)).rejects.toMatchObject({ code: 'LIVE_CONFLICT' });
    mocks.claim.mockResolvedValue({ count: 0 }); await expect(addLiveChunk('s1', 'u1', 0, audio)).rejects.toMatchObject({ code: 'LIVE_CONFLICT' }); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('returns duplicate DONE without another ASR call and rejects changed bytes', async (): Promise<void> => {
    const { createHash } = await import('node:crypto'); mocks.chunk.mockResolvedValue({ state: 'DONE', digest: createHash('sha256').update(Buffer.alloc(3200)).digest('hex') });
    await addLiveChunk('s1', 'u1', 0, audio); expect(mocks.run).not.toHaveBeenCalled();
    await expect(addLiveChunk('s1', 'u1', 0, Buffer.alloc(3200, 1).toString('base64'))).rejects.toMatchObject({ code: 'LIVE_CONFLICT' });
  });
  it('marks failed ASR explicitly, releases its token and does not advance duration', async (): Promise<void> => {
    mocks.run.mockRejectedValue(new Error('do not relay raw worker details')); mocks.session.mockImplementation(async (): Promise<unknown> => ({ ...session, processingToken: mocks.claim.mock.calls[0]?.[0].data.processingToken }));
    await expect(addLiveChunk('s1', 'u1', 0, audio)).rejects.toMatchObject({ code: 'LIVE_ASR_UNAVAILABLE' });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'FAILED' }) }));
    expect(mocks.claim.mock.calls.some((call): boolean => Boolean(call[0].data.totalSamples))).toBe(false);
    expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('does not finish a failed chunk without explicit partial choice', async (): Promise<void> => {
    mocks.chunks.mockResolvedValue([{ sequence: 0, state: 'FAILED', text: '', startMs: 0, endMs: 100, reason: '失败' }]);
    await expect(finishLive('s1', 'u1')).rejects.toMatchObject({ code: 'LIVE_CONFLICT' });
    await finishLive('s1', 'u1', true); expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ summaryMarkdown: expect.stringContaining('笔记可能不完整') }) }));
  });
  it('recovers only the expired lease before explicit partial finish', async (): Promise<void> => {
    const expired = { ...session, processingSequence: 0, processingToken: 'old-token', processingStartedAt: new Date(Date.now() - 130_000) };
    mocks.session.mockResolvedValueOnce(expired).mockResolvedValue(session);
    mocks.chunks.mockResolvedValue([{ sequence: 0, state: 'FAILED', text: '', startMs: 0, endMs: 100, reason: '中断' }]);
    await finishLive('s1', 'u1', true);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ processingToken: 'old-token', processingStartedAt: expired.processingStartedAt }) }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId: 's1', state: 'RUNNING' }, data: expect.objectContaining({ state: 'FAILED' }) }));
  });
  it('does not release an active lease or finish its audio prematurely', async (): Promise<void> => {
    mocks.session.mockResolvedValue({ ...session, processingSequence: 0, processingToken: 'active', processingStartedAt: new Date() });
    await expect(finishLive('s1', 'u1', true)).rejects.toMatchObject({ code: 'LIVE_CONFLICT' });
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not call model on silent windows and retains explicit source cutoff', async (): Promise<void> => {
    mocks.chunks.mockResolvedValue([{ sequence: 0, text: '', startMs: 0, endMs: 100, state: 'DONE' }]);
    await liveHighlights('s1', 'u1'); expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastHighlightSequence: 0 }) }));
  });
});
