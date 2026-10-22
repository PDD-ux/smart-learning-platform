import type { LearningContent } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { toContentSummary, resolveCoverUrl } from '@/lib/domain/content-mapper';

/**
 * ContentSummary 映射 单测（tasks.md §3.2）
 */

function makeRow(overrides: Partial<LearningContent> = {}): LearningContent {
  return {
    urlSource: null,
    bookState: null, bookRevision: 0,
    id: 'c1',
    ownerId: 'u1',
    contentType: 'VIDEO',
    title: '第 1 讲',
    description: null,
    fileName: 'lesson.mp4',
    format: 'MP4',
    durationSec: 12,
    pageCount: null,
    fileSizeBytes: BigInt(1024),
    storageKey: 'contents/c1/lesson.mp4',
    coverUrl: null,
    status: 'PARSING',
    failReason: null,
    understandingStatus: 'RUNNING',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toContentSummary', () => {
  it('maps enums to API labels and keeps ISO timestamps', () => {
    const summary = toContentSummary(makeRow());
    expect(summary).toEqual({
      contentId: 'c1',
      contentType: 'video',
      title: '第 1 讲',
      description: null,
      durationSec: 12,
      pageCount: null,
      status: '解析中',
      coverUrl: null,
      understandingStatus: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('maps documents and READY/completed states', () => {
    const summary = toContentSummary(
      makeRow({
        contentType: 'DOCUMENT',
        status: 'READY',
        understandingStatus: 'COMPLETED',
        durationSec: null,
        pageCount: 42,
        description: '讲义',
      }),
    );
    expect(summary.contentType).toBe('document');
    expect(summary.status).toBe('已就绪');
    expect(summary.understandingStatus).toBe('completed');
    expect(summary.pageCount).toBe(42);
  });

  it('does not leak BigInt fields', () => {
    const summary = toContentSummary(makeRow());
    expect(Object.values(summary).some((v) => typeof v === 'bigint')).toBe(false);
  });

  it('uses the resolved cover url override', () => {
    const summary = toContentSummary(makeRow({ coverUrl: 'covers/c1/cover.jpg' }), 'http://x/cover.jpg');
    expect(summary.coverUrl).toBe('http://x/cover.jpg');
  });

  it('resolveCoverUrl returns null for an empty key', async () => {
    await expect(resolveCoverUrl(null)).resolves.toBeNull();
  });
});
