vi.mock('@/services/books',()=>({books:{read:vi.fn(async():Promise<object>=>({book:null})),write:vi.fn()}}));
import { createElement, type ReactNode } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  format: 'JPEG',
  pageCount: 1,
  type: 'document',
  phase: 'completed',
  blocks: [] as Array<{ blockId: string; ref: { type: 'document'; page: number }; text: string; source: string }>,
}));

vi.mock('next/navigation', () => {
  const router = { replace: vi.fn() };
  return {
  useParams: () => ({ id: 'image_content' }),
  useRouter: () => router,
  };
});

vi.mock('@/components/app/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}));

vi.mock('@/services/api', () => ({
  ApiClientError: class ApiClientError extends Error {},
  api: {
    content: vi.fn(async () => ({ contentId: 'image_content', contentType: fixture.type, title: '课堂截图', status: '已就绪', pageCount: fixture.pageCount })),
    resource: vi.fn(async () => ({ contentId: 'image_content', contentType: fixture.type, format: fixture.format, url: '/image', pageCount: fixture.pageCount })),
    understanding: vi.fn(async () => ({ contentId: 'image_content', textBlocks: fixture.blocks, transcriptSegments: fixture.type === 'video' ? [{ segmentId: 's', seq: 0, startMs: 0, endMs: 1000, text: '老师的讲话' }] : [], knowledgePoints: [], status: 'completed' })),
    notes: vi.fn(async () => ({ items: [] })),
    progress: vi.fn(async () => ({ contentType: 'document', page: 1, scrollRatio: 0 })),
    understandingStatus: vi.fn(async () => ({ phase: fixture.phase })),
    generatedNote: vi.fn(async () => ({ note: null })),
  },
}));

import StudyPage from '@/app/study/[id]/page';

afterEach(() => {
  cleanup();
  fixture.blocks = [];
  fixture.format = 'JPEG';
  fixture.pageCount = 1;
  fixture.type = 'document';
  fixture.phase = 'completed';
});

describe('study text blocks', () => {
  it('uses a valid citation page instead of the stored first page', async () => {
    fixture.format = 'PDF';
    fixture.pageCount = 3;
    render(<StudyPage searchParams={{ page: '2' }} />);
    expect(await screen.findByText('PDF 阅读 · 第 2 / 3 页')).toBeTruthy();
    const image = screen.getByAltText('课堂截图 第 2 页');
    expect(new URL(image.getAttribute('src') ?? '', window.location.href).href).toBe(new URL('/image&page=2', window.location.href).href);
    expect(image.getAttribute('srcset')).toBeNull();
  });
  it('shows short English code recognized from an image', async () => {
    fixture.blocks = [
      { blockId: 'ocr_1', ref: { type: 'document', page: 1 }, text: 'cleanup()', source: 'ocr' },
      { blockId: 'ocr_2', ref: { type: 'document', page: 1 }, text: 'fmt.Println', source: 'ocr' },
    ];

    render(createElement(StudyPage));

    expect(await screen.findByText('cleanup()')).toBeTruthy();
    const image = screen.getByAltText('课堂截图');
    expect(new URL(image.getAttribute('src') ?? '', window.location.href).href).toBe(new URL('/image', window.location.href).href);
    expect(image.getAttribute('srcset')).toBeNull();
    expect(screen.getByText('fmt.Println')).toBeTruthy();
    expect(screen.getByText('2 块')).toBeTruthy();
  });

  it('keeps filtering symbol-only PDF extraction and uses a PDF-specific empty state', async () => {
    fixture.format = 'PDF';
    fixture.blocks = [{ blockId: 'pdf_1', ref: { type: 'document', page: 1 }, text: '....----', source: 'pdf' }];

    render(createElement(StudyPage));

    expect(await screen.findByText('0 块')).toBeTruthy();
    expect(screen.queryByText('....----')).toBeNull();
    expect(screen.getByText(/当前 PDF 未提取到可靠文字/)).toBeTruthy();
  });

  it('does not claim an image is a PDF when OCR has no blocks', async () => {
    render(createElement(StudyPage));

    expect(await screen.findByText('0 块')).toBeTruthy();
    expect(screen.getByText(/暂无可显示的识别文字/)).toBeTruthy();
    expect(screen.queryByText(/当前 PDF 未提取到可靠文字/)).toBeNull();
  });
});

for (const [phase, expected] of [
  ['completed', '理解任务已结束，但没有保存画面 OCR 文字'],
  ['light-filter', '视频仍在理解处理中'],
  ['failed', '本次理解任务失败'],
  ['none', '视频尚未启动理解'],
]) {
  it(`distinguishes video OCR absence from speech when phase is ${phase}`, async (): Promise<void> => {
    fixture.type = 'video'; fixture.format = 'MP4'; fixture.phase = phase;
    render(createElement(StudyPage));
    expect(await screen.findByText(new RegExp(expected))).toBeTruthy();
    expect(screen.getByText(/此处只显示板书、课件/)).toBeTruthy();
    if (phase === 'completed') {
      expect(screen.getByText(/已有 1 段语音转写/)).toBeTruthy();
      expect(screen.getByText(/仅凭 0 块无法判断/)).toBeTruthy();
    }
  });
}
