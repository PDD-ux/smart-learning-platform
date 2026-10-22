import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

const route = vi.hoisted(() => ({
  pathname: '/dashboard',
  params: { id: 'content_main' },
  replace: vi.fn(),
}));

const journey = vi.hoisted(() => {
  const content = {
    contentId: 'content_main',
    contentType: 'video' as const,
    title: '反向传播入门课程',
    description: null,
    durationSec: 120,
    pageCount: null,
    status: '已就绪' as const,
    coverUrl: null,
    understandingStatus: 'completed' as const,
    createdAt: '2026-09-17T09:00:00.000Z',
    updatedAt: '2026-09-17T09:10:00.000Z',
  };
  const notes: Array<{
    noteId: string;
    contentId: string;
    content: string;
    ref: { type: 'video'; timestampSec: number };
    version: number;
    createdAt: string;
    updatedAt: string;
  }> = [];
  let reviewed = false;

  const api = {
    contents: vi.fn(async () => ({ page: 1, pageSize: 50, total: 1, items: [content] })),
    content: vi.fn(async () => content),
    resource: vi.fn(async () => ({ contentId: content.contentId, contentType: 'video' as const, url: 'https://example.test/lesson.mp4', expiresInSec: 900, durationSec: 120, pageCount: null, format: 'MP4' })),
    understanding: vi.fn(async () => ({
      contentId: content.contentId,
      transcriptSegments: [{ segmentId: 'segment_1', seq: 0, startMs: 12_000, endMs: 18_000, text: '链式法则用于把误差逐层传回各层参数。' }],
      textBlocks: [{ blockId: 'block_1', ref: { type: 'video' as const, timestampSec: 12 }, text: '反向传播核心公式', source: 'FRAME' }],
      knowledgePoints: [{ pointId: 'point_backprop', title: '反向传播', summary: '使用链式法则计算参数梯度。', tags: ['深度学习'], importance: 5, refs: [{ type: 'video' as const, timestampSec: 12 }] }],
      status: 'completed',
    })),
    understandingStatus: vi.fn(async () => ({ contentId: content.contentId, phase: 'completed', stageDetail: {} })),
    generatedNote: vi.fn(async () => ({ note: { markdown: '# AI 整理笔记\n\n反向传播通过链式法则计算梯度。', sourceCount: 1, generatedAt: '2026-09-17T09:21:00.000Z' } })),
    regenerateGeneratedNote: vi.fn(async () => ({ note: { markdown: '# AI 整理笔记\n\n反向传播通过链式法则计算梯度。', sourceCount: 1, generatedAt: '2026-09-17T09:22:00.000Z' } })),
    notes: vi.fn(async () => ({ items: [...notes] })),
    createNote: vi.fn(async (contentId: string, body: { content: string; ref: { type: 'video'; timestampSec: number } }) => {
      const saved = { noteId: `note_${notes.length + 1}`, contentId, content: body.content, ref: body.ref, version: 1, createdAt: '2026-09-17T09:20:00.000Z', updatedAt: '2026-09-17T09:20:00.000Z' };
      notes.push(saved);
      return saved;
    }),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    progress: vi.fn(async () => ({ contentType: 'video' as const, positionSec: 0, lastStudiedAt: null })),
    saveProgress: vi.fn(async () => ({ contentType: 'video' as const, ref: { type: 'video' as const, positionSec: 0 }, lastStudiedAt: null })),
    qa: vi.fn(async () => ({ qaId: 'qa_1', answer: '它把损失函数的梯度沿网络逐层传递。', citations: [{ ref: { type: 'video' as const, timestampSec: 12 }, excerpt: '链式法则用于把误差逐层传回各层参数。' }], createdAt: '2026-09-17T09:21:00.000Z' })),
    summary: vi.fn(async () => ({ summaryId: 'summary_1', summary: '反向传播通过链式法则计算梯度。', basedOn: {}, generatedAt: '2026-09-17T09:21:00.000Z' })),
    flashcards: vi.fn(async () => ({ total: 1, items: [{ flashcardId: 'card_1', contentId: content.contentId, pointId: 'point_backprop', cardType: 'QA', front: '反向传播的核心是什么？', back: '使用链式法则计算梯度。', hint: '从输出层向前', status: 'NEW', nextReviewAt: '2026-09-17T00:00:00.000Z', easeFactor: 2.5, intervalDays: 0 }] })),
    review: vi.fn(async () => {
      reviewed = true;
      return { xpGain: 10, newStreak: 1, newXpTotal: 10, levelUp: null, unlockedAchievements: [] };
    }),
    weakPoints: vi.fn(async () => ({ items: [{ pointId: 'point_backprop', title: '反向传播', tags: ['深度学习'], score: reviewed ? 0.52 : 0.42, contentId: content.contentId, contentTitle: content.title, relatedFlashcardCount: 1, lastReviewAt: reviewed ? '2026-09-17T09:22:00.000Z' : null }] })),
    mastery: vi.fn(async () => ({ items: [{ pointId: 'point_backprop', title: '反向传播', score: reviewed ? 0.52 : 0.42, isWeak: true, reviewCount: reviewed ? 1 : 0, correctRate: reviewed ? 1 : 0 }] })),
    graphOverview: vi.fn(async () => ({
      nodes: [{
        pointId: 'point_backprop', title: '反向传播', nodeType: 'concept' as const,
        mastery: reviewed ? 0.52 : 0.42, isWeak: true,
        reviewCount: reviewed ? 1 : 0, correctRate: reviewed ? 1 : 0,
        relatedNoteCount: notes.length, relatedFlashcardCount: 1,
        lastReviewedAt: reviewed ? '2026-09-17T09:22:00.000Z' : null,
        pointIds: ['point_backprop'], contentIds: [content.contentId], aliases: [],
        weakPointCount: 1,
      }],
      edges: [],
      summary: { contentCount: 1, nodeCount: 1, weakPointCount: 1, edgeCount: 0 },
    })),
    contentGraph: vi.fn(async () => ({
      nodes: [{
        pointId: 'point_backprop', title: '反向传播', nodeType: 'concept' as const,
        mastery: reviewed ? 0.52 : 0.42, isWeak: true,
        reviewCount: reviewed ? 1 : 0, correctRate: reviewed ? 1 : 0,
        relatedNoteCount: notes.length, relatedFlashcardCount: 1,
        lastReviewedAt: reviewed ? '2026-09-17T09:22:00.000Z' : null,
      }],
      edges: [],
    })),
    messages: vi.fn(async () => ({ page:1,pageSize:20,total:0,unreadCount:0,asOf:"2026-10-14T00:00:00Z",items:[] })),
    profile: vi.fn(async () => ({ role: 'student' as const, xpTotal: reviewed ? 10 : 0, currentLevel: 'Lv.1 · 新手', achievements: [] })),
    generateExercise: vi.fn(),
    exercises: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 10 })),
    answerExercise: vi.fn(),
  };

  return {
    api,
    reset(): void {
      notes.length = 0;
      reviewed = false;
      for (const value of Object.values(api)) {
        if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
      }
      api.flashcards.mockImplementation(async () => ({ total: 1, items: [{ flashcardId: 'card_1', contentId: content.contentId, pointId: 'point_backprop', cardType: 'QA', front: '反向传播的核心是什么？', back: '使用链式法则计算梯度。', hint: '从输出层向前', status: 'NEW', nextReviewAt: '2026-09-17T00:00:00.000Z', easeFactor: 2.5, intervalDays: 0 }] }));
    },
  };
});

vi.mock('@/services/attendance', () => ({ attendanceApi: { today: vi.fn(async () => ({ date: '2026-10-09', checkedIn: false, method: null, signedAt: null })) } }));

vi.mock('next/link', () => ({
  default: function TestLink({ children, ...props }: TestLinkProps): ReturnType<typeof createElement> {
    return createElement('a', props, children);
  },
}));

vi.mock('next/navigation', () => {
  const router = { replace: route.replace };
  return {
  usePathname: () => route.pathname,
  useParams: () => route.params,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  };
});

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, api: journey.api };
});

import DashboardPage from '@/app/dashboard/page';
import GraphPage from '@/app/graph/page';
import ImportPage from '@/app/import/page';
import ReviewPage from '@/app/review/page';
import StudyPage from '@/app/study/[id]/page';
import { AppShell } from '@/components/app/AppShell';

describe('learner main-path acceptance', () => {
  it('exposes check-in through the topbar without treating it as the study-plan page', async () => {
    route.pathname = '/attendance';
    render(<AppShell title="自习打卡"><p>开始自习</p></AppShell>);
    const nav = await screen.findByRole('navigation', { name: '学习功能' });
    expect(within(nav).queryByRole('link', { name: '人脸签到' })).toBeNull();
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('link', { name: '智能批改' }).getAttribute('href')).toBe('/homework');
    expect(within(nav).getByRole('link', { name: '班级课程' }).getAttribute('href')).toBe('/classes');
    expect(within(nav).getByRole('link', { name: '工作台' }).classList.contains('is-active')).toBe(false);
    expect(screen.getByRole('link', { name: '打卡与人脸设置' }).getAttribute('aria-current')).toBe('page');
  });
  it('opens a citation after metadata loads without autoplay and ignores an out-of-range time', async () => {
    route.pathname = '/study/content_main';
    const view = render(<StudyPage searchParams={{ t: '62' }} />);
    await screen.findByRole('region', { name: '播放同步笔记' });
    await waitFor(() => expect(view.container.querySelector('video')).toBeTruthy());
    const video = view.container.querySelector('video');
    if (!video) throw new Error('Missing video player');
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(62);
    expect(video.paused).toBe(true);
    view.rerender(<StudyPage searchParams={{ t: '121' }} />);
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
  });
  beforeEach(() => {
    journey.reset();
    route.pathname = '/dashboard';
    route.params = { id: 'content_main' };
    route.replace.mockClear();
    window.localStorage.setItem('smart-learning-access-token', 'acceptance-token');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('connects actual player events, source seek and saved supplements to the personal note list', async () => {
    route.pathname = '/study/content_main';
    const view = render(createElement(StudyPage));
    const panel = await screen.findByRole('region', { name: '播放同步笔记' });
    await act(async (): Promise<void> => {});
    const video = view.container.querySelector('video');
    if (!video) throw new Error('Missing video player');
    vi.spyOn(video, 'play').mockResolvedValue(undefined);
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.currentTime = 12.5;
    fireEvent.timeUpdate(video);
    expect(within(panel).getByText('反向传播')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('补充我的笔记'), { target: { value: '播放同步的个人补充' } });
    video.currentTime = 70;
    fireEvent.seeking(video);
    fireEvent.pause(video);
    expect(within(panel).getByText('播放 1:10')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '保存补充' }));
    expect(await within(panel).findByText('已保存到我的笔记')).toBeTruthy();
    expect(journey.api.createNote).toHaveBeenCalledWith('content_main', { content: '播放同步的个人补充', ref: { type: 'video', timestampSec: 12 } });
    fireEvent.click(within(panel).getByRole('button', { name: '回看 0:12' }));
    expect(video.currentTime).toBe(12);
    fireEvent.click(screen.getByRole('button', { name: '我的笔记' }));
    expect(screen.getByText('播放同步的个人补充')).toBeTruthy();
    video.currentTime = 2;
    fireEvent.timeUpdate(video);
    expect(within(panel).queryByText('反向传播')).toBeNull();
    expect(within(panel).getByText(/还未播放到首个重点/)).toBeTruthy();
  });

  it('keeps import, study, review, weak-point, graph, and cited QA state consistent for one learner', async () => {
    const importView = render(createElement(ImportPage));
    expect(await screen.findByText('反向传播入门课程')).toBeTruthy();
    expect(screen.getByRole('link', { name: '进入学习' }).getAttribute('href')).toBe('/study/content_main');
    importView.unmount();

    route.pathname = '/study/content_main';
    const studyView = render(createElement(StudyPage));
    expect(await screen.findByText('反向传播')).toBeTruthy();
    expect(await screen.findByText('链式法则用于把误差逐层传回各层参数。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '我的笔记' }));
    const noteInput = screen.getByPlaceholderText('记录此刻的理解，停止输入 1 秒后自动保存…');
    fireEvent.change(noteInput, { target: { value: '梯度要从输出层逐层回传。' } });
    fireEvent.click(screen.getByRole('button', { name: '立即保存' }));
    expect(await screen.findByText('梯度要从输出层逐层回传。')).toBeTruthy();
    expect(journey.api.createNote).toHaveBeenCalledWith('content_main', expect.objectContaining({ content: '梯度要从输出层逐层回传。' }));

    const questionInput = screen.getByPlaceholderText('只基于本内容提问…');
    fireEvent.change(questionInput, { target: { value: '链式法则有什么作用？' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(await screen.findByText('它把损失函数的梯度沿网络逐层传递。')).toBeTruthy();
    expect(screen.getByText('引用出处')).toBeTruthy();
    expect(screen.getByText(/\[0:12\] 链式法则用于把误差逐层传回各层参数。/)).toBeTruthy();
    studyView.unmount();

    route.pathname = '/review';
    const reviewView = render(createElement(ReviewPage));
    expect(await screen.findByText('反向传播的核心是什么？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看要点' }));
    expect(await screen.findByText('使用链式法则计算梯度。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3 · 熟练' }));
    expect(await screen.findByText('本次复习完成')).toBeTruthy();
    expect(journey.api.review).toHaveBeenCalledWith('card_1', 3);
    reviewView.unmount();

    route.pathname = '/graph';
    const graphView = render(createElement(GraphPage));
    await screen.findByRole('heading', {name: '知识图谱', level: 1});
    fireEvent.click(await screen.findByRole('button', { name: /^反向传播\s*待补强$/ }));
    const graphDetails = (await screen.findByRole('heading', { name: '反向传播' })).closest('section')!;
    expect(within(graphDetails).getByText('52%')).toBeTruthy();
    expect(screen.getAllByText('52%')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: '需要巩固' }));
    expect(screen.getByRole('link', { name: '复习' }).getAttribute('href')).toBe('/review?contentId=content_main');
    graphView.unmount();

    route.pathname = '/dashboard';
    render(createElement(DashboardPage));
    await waitFor(() => expect(journey.api.notes).toHaveBeenCalledWith('content_main'));
    expect(screen.getByRole('link', { name: /查看知识图谱/ }).getAttribute('href')).toBe('/graph');
    const tasks = screen.getByRole('region', { name: '今日学习任务' });
    const checkIn = screen.getByRole('region', { name: '今日打卡' });
    const overview = screen.getByRole('region', { name: '学习概览' });
    expect(tasks.compareDocumentPosition(checkIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tasks.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
