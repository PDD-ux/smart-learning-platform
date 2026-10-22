import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentResult, ContentList, ContentSummary, QaResult } from '@/services/api';

type TestLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };

const fixture = vi.hoisted(() => ({
  api: {
    contents: vi.fn(async (): Promise<ContentList> => ({ page: 1, pageSize: 50, total: 0, items: [] })),
    qa: vi.fn(async (_contentId: string, _question: string): Promise<QaResult> => ({
      qaId: 'qa-1',
      answer: '反向传播使用链式法则计算梯度。',
      citations: [{ ref: { type: 'video', timestampSec: 62 }, excerpt: '误差沿网络逐层传回各层参数。' }],
      createdAt: '2026-10-08T00:00:00.000Z',
    })),
    agent: vi.fn(), createStudyPlan: vi.fn(), studyPlans: vi.fn(), answerExercise: vi.fn(),
  },
}));

vi.mock('next/link', () => ({
  default: function TestLink({ children, ...props }: TestLinkProps): ReturnType<typeof createElement> {
    return createElement('a', props, children);
  },
}));

vi.mock('@/components/app/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, api: fixture.api };
});

import AssistantPage from '@/app/assistant/page';
import { ApiClientError } from '@/services/api';
vi.mock('@/components/review/ExerciseSourcePanel', () => ({ ExerciseSourcePanel: (): ReturnType<typeof createElement> => createElement('p', null, '真实作答后的来源面板') }));
const agentResult: AgentResult = { runId: 'run-1', contentId: 'lesson-1', answer: '暂无掌握记录，先核对原文并自行练习。', createdAt: '', citations: [{ ref: { type: 'video', timestampSec: 62 }, excerpt: '实际原文片段' }], steps: [{ tool: 'learning_status', label: '读取学习记录', summary: '最近0次作答' }, { tool: 'search_material', label: '检索资料原文', summary: '找到1段原文' }, { tool: 'select_practice', label: '挑选针对练习', summary: '挑选1题' }], practice: [{ exerciseId: 'q1', pointId: 'p1', contentId: 'lesson-1', contentTitle: '反向传播课程', pointTitle: '链式法则', type: 'single_choice', question: '选择计算法则', options: ['链式法则', '任意相加'], index: 1, latestRecord: null }], plan: { title: '巩固链式法则', targetMinutes: 20, steps: [{ title: '阅读原文', minutes: 10, pointTitles: ['链式法则'] }, { title: '练习并核对', minutes: 10, pointTitles: ['链式法则'] }] } };
async function qaMode(): Promise<void> { await screen.findByLabelText('输入学习问题'); }

async function agentMode(): Promise<void> {
  await screen.findByLabelText('输入学习问题');
  const details = screen.getByText(/更多学习工具/).closest('details')!;
  if (!details.open) fireEvent.click(details.querySelector('summary')!);
  fireEvent.click(screen.getByRole('button', { name: '学习 Agent' }));
}

function content(contentId: string, title: string, status: ContentSummary['status'], understandingStatus: ContentSummary['understandingStatus']): ContentSummary {
  return {
    contentId,
    contentType: 'video',
    title,
    description: null,
    durationSec: 120,
    pageCount: null,
    status,
    coverUrl: null,
    understandingStatus,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
  };
}

function contentList(items: ContentSummary[]): ContentList {
  return { page: 1, pageSize: 50, total: items.length, items };
}

it('opens the explicitly linked ready material without sending a model request', async (): Promise<void> => {
  fixture.api.contents.mockResolvedValue(contentList([content('lesson-1', '第一份', '已就绪', 'completed'), content('lesson-2', '第二份', '已就绪', 'completed')]));
  render(<AssistantPage searchParams={{ contentId: 'lesson-2' }} />);
  await screen.findByLabelText('选择学习资料');
  expect((screen.getByLabelText('选择学习资料') as HTMLSelectElement).value).toBe('lesson-2');
  expect(fixture.api.agent).not.toHaveBeenCalled(); expect(fixture.api.qa).not.toHaveBeenCalled();
});

it('ignores an old answer after the navigation query changes the material scope', async (): Promise<void> => {
  fixture.api.contents.mockResolvedValue(contentList([content('lesson-1', '第一份', '已就绪', 'completed'), content('lesson-2', '第二份', '已就绪', 'completed')]));
  let finish!: (value: AgentResult) => void;
  fixture.api.agent.mockReturnValueOnce(new Promise<AgentResult>((resolve): void => { finish = resolve; }));
  const view = render(<AssistantPage searchParams={{ contentId: 'lesson-1' }} />);
  await agentMode();
  fireEvent.change(screen.getByLabelText('输入学习问题'), { target: { value: '只问第一份资料' } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
  view.rerender(<AssistantPage searchParams={{ contentId: 'lesson-2' }} />);
  await screen.findByLabelText('输入学习问题');
  await act(async (): Promise<void> => { finish({ ...agentResult, answer: '旧范围迟到回答' }); });
  expect((screen.getByLabelText('选择学习资料') as HTMLSelectElement).value).toBe('lesson-2');
  expect(screen.queryByText('旧范围迟到回答')).toBeNull();
  expect(screen.queryByText('只问第一份资料')).toBeNull();
});

it('leaves an unavailable linked material unselected until the learner chooses a valid material', async (): Promise<void> => {
  fixture.api.contents.mockResolvedValue(contentList([content('lesson-1', '可用资料', '已就绪', 'completed')]));
  render(<AssistantPage searchParams={{ contentId: 'foreign' }} />);
  await screen.findByText('链接指定的资料不在当前可用列表中，请手动选择本人资料。');
  expect(screen.queryByLabelText('输入学习问题')).toBeNull();
  fireEvent.change(screen.getByLabelText('选择学习资料'), { target: { value: 'lesson-1' } });
  await screen.findByLabelText('输入学习问题');
  expect(fixture.api.agent).not.toHaveBeenCalled();
});

beforeEach(() => {
  fixture.api.agent.mockReset(); fixture.api.agent.mockResolvedValue(agentResult);
  fixture.api.createStudyPlan.mockReset(); fixture.api.createStudyPlan.mockResolvedValue({ planId: 'plan-1' });
  fixture.api.studyPlans.mockReset(); fixture.api.studyPlans.mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] });
  fixture.api.answerExercise.mockReset(); fixture.api.answerExercise.mockResolvedValue({ correct: false, correctAnswer: 'A', explanation: '链式法则解析' });
  fixture.api.contents.mockReset();
  fixture.api.contents.mockResolvedValue(contentList([content('lesson-1', '反向传播课程', '已就绪', 'completed')]));
  fixture.api.qa.mockReset();
  fixture.api.qa.mockResolvedValue({
    qaId: 'qa-1',
    answer: '反向传播使用链式法则计算梯度。',
    citations: [{ ref: { type: 'video', timestampSec: 62 }, excerpt: '误差沿网络逐层传回各层参数。' }],
    createdAt: '2026-10-08T00:00:00.000Z',
  });
});

afterEach(() => {
  cleanup();
});

describe('AI learning assistant', () => {
  it.each(['核对原文', '诊断练习', '安排复习'])('fills the %s scenario draft without sending or saving', async (title): Promise<void> => {
    render(<AssistantPage />);
    await agentMode();
    fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + title) }));
    expect((screen.getByLabelText('输入学习问题') as HTMLTextAreaElement).value).toContain('所选资料');
    expect(fixture.api.agent).not.toHaveBeenCalled();
    expect(fixture.api.qa).not.toHaveBeenCalled();
    expect(fixture.api.createStudyPlan).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '先查看所选资料原文 →' }).getAttribute('href')).toBe('/study/lesson-1');
  });
  it('locks scenario drafts during a request and restores an unavailable-model draft without invented actions', async (): Promise<void> => {
    let reject: (reason: unknown) => void = () => undefined;
    fixture.api.agent.mockImplementationOnce(() => new Promise<AgentResult>((_resolve, failure) => { reject = failure; }));
    render(<AssistantPage />); await agentMode();
    fireEvent.click(screen.getByRole('button', { name: /^诊断练习/ }));
    const draft = (screen.getByLabelText('输入学习问题') as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    expect((screen.getByRole('button', { name: /^安排复习/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async (): Promise<void> => { reject(new ApiClientError('模型不可用', 503, 'AI_UNAVAILABLE')); });
    await screen.findByRole('alert');
    expect((screen.getByLabelText('输入学习问题') as HTMLTextAreaElement).value).toBe(draft);
    expect(screen.queryByRole('region', { name: '实际推荐练习' })).toBeNull();
    expect(screen.queryByRole('region', { name: '复习方案预览' })).toBeNull();
    expect(fixture.api.createStudyPlan).not.toHaveBeenCalled();
  });
  it('makes missing citations explicit and scopes the empty-practice route to the current material', async (): Promise<void> => {
    fixture.api.agent.mockResolvedValue({ ...agentResult, citations: [], practice: [] });
    render(<AssistantPage />); await submitAgent();
    expect(screen.getByText(/本次回答没有可点击的原文依据/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '回看所选资料' }).getAttribute('href')).toBe('/study/lesson-1');
    expect(screen.getByRole('link', { name: '查看这份资料的题库' }).getAttribute('href')).toBe('/question-bank?contentId=lesson-1');
    expect(screen.getByText('预览 · 尚未保存 · 20 分钟')).toBeTruthy();
    expect(fixture.api.createStudyPlan).not.toHaveBeenCalled();
  });
  it('only offers ready content with completed understanding', async () => {
    fixture.api.contents.mockResolvedValue(contentList([
      content('lesson-1', '可问答课程', '已就绪', 'completed'),
      content('lesson-2', '仍在解析课程', '解析中', 'running'),
      content('lesson-3', '解析尚未完成课程', '已就绪', 'running'),
    ]));

    render(createElement(AssistantPage));

    expect(await screen.findByRole('option', { name: '可问答课程' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '仍在解析课程' })).toBeNull();
    expect(screen.queryByRole('option', { name: '解析尚未完成课程' })).toBeNull();
  });

  it('submits a grounded question and links its citation to the learning page', async () => {
    render(createElement(AssistantPage));
    await qaMode();

    const questionInput = await screen.findByLabelText('输入学习问题');
    fireEvent.change(questionInput, { target: { value: '反向传播的核心是什么？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));

    expect(await screen.findByText('反向传播使用链式法则计算梯度。')).toBeTruthy();
    expect(screen.getByText('误差沿网络逐层传回各层参数。')).toBeTruthy();
    expect(screen.getByRole('link', { name: /视频 1:02 · 查看学习资料/ }).getAttribute('href')).toBe('/study/lesson-1?t=62');
    expect(fixture.api.qa).toHaveBeenCalledWith('lesson-1', '反向传播的核心是什么？');
  });

  it('clears the current conversation when the selected content changes', async () => {
    fixture.api.contents.mockResolvedValue(contentList([
      content('lesson-1', '反向传播课程', '已就绪', 'completed'),
      content('lesson-2', '卷积课程', '已就绪', 'completed'),
    ]));
    render(createElement(AssistantPage));

    await qaMode();

    fireEvent.change(await screen.findByLabelText('输入学习问题'), { target: { value: '反向传播的核心是什么？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    expect(await screen.findByText('反向传播使用链式法则计算梯度。')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('选择学习资料'), { target: { value: 'lesson-2' } });

    expect(screen.queryByText('反向传播使用链式法则计算梯度。')).toBeNull();
    expect(screen.getByText('围绕这份资料提出一个具体问题。')).toBeTruthy();
  });

  it('shows a clear rate-limit message and supports the no-material state', async () => {
    fixture.api.qa.mockRejectedValue(new ApiClientError('请求过于频繁', 429, 'RATE_LIMITED'));
    render(createElement(AssistantPage));
    await qaMode();

    fireEvent.change(await screen.findByLabelText('输入学习问题'), { target: { value: '问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    expect((await screen.findByRole('alert')).textContent).toContain('提问太频繁了，请稍后再试。');

    cleanup();
    fixture.api.contents.mockResolvedValue(contentList([]));
    render(createElement(AssistantPage));
    expect(await screen.findByText('还没有可用于问答的资料')).toBeTruthy();
    expect(screen.getByRole('link', { name: '前往导入资料' }).getAttribute('href')).toBe('/import');
  });
});

async function submitAgent(): Promise<void> {
  await agentMode();
  fireEvent.change(await screen.findByLabelText('输入学习问题'), { target: { value: '安排复习' } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
  await screen.findByText(agentResult.answer);
}
it('opens optional Agent, shows real tools and source, and saves a plan only on explicit click once', async () => {
  render(<AssistantPage />); await submitAgent();
  expect(fixture.api.agent).toHaveBeenCalledWith({ contentId: 'lesson-1', message: '安排复习', minutes: 20, history: [] });
  expect(screen.getByText('读取学习记录 · 最近0次作答', { exact: false })).toBeTruthy();
  expect(screen.getByRole('link', { name: /视频 1:02/ }).getAttribute('href')).toBe('/study/lesson-1?t=62');
  expect(fixture.api.createStudyPlan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('确认保存到学习计划')); fireEvent.click(screen.getByText('正在处理…'));
  await screen.findByText('计划已保存。'); expect(fixture.api.createStudyPlan).toHaveBeenCalledTimes(1);
  expect(fixture.api.createStudyPlan).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'lesson-1', title: '巩固链式法则', targetMinutes: 20 }));
});
it('preserves failed plan inputs, checks ambiguous success and does not duplicate the plan', async () => {
  fixture.api.createStudyPlan.mockRejectedValue(new Error('网络中断'));
  render(<AssistantPage />); await submitAgent();
  const time = (screen.getByLabelText('学习时间') as HTMLInputElement).value;
  fireEvent.click(screen.getByText('确认保存到学习计划')); await screen.findByText(/网络中断/);
  expect((screen.getByLabelText('学习时间') as HTMLInputElement).value).toBe(time);
  expect((screen.getByText('确认保存到学习计划') as HTMLButtonElement).disabled).toBe(true);
  const body = fixture.api.createStudyPlan.mock.calls[0][0];
  fixture.api.studyPlans.mockResolvedValue({ page: 1, pageSize: 10, total: 1, items: [{ ...body, planId: 'existing' }] });
  fireEvent.click(screen.getByText('核对保存状态')); await screen.findByText('计划已保存。'); expect(fixture.api.createStudyPlan).toHaveBeenCalledTimes(1);
});
it('uses real practice submission and seeds a fresh database-based analysis after exit', async () => {
  render(<AssistantPage />); await submitAgent(); fireEvent.click(screen.getByText('开始针对练习 · 1 题'));
  expect(screen.queryByText('链式法则解析')).toBeNull(); expect(screen.getByText('本组已答 0 / 1 题')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: /任意相加/ })); fireEvent.click(screen.getByText('提交本题答案'));
  await screen.findByText('还需巩固'); expect(fixture.api.answerExercise).toHaveBeenCalledWith('q1', 'B');
  fireEvent.click(screen.getByText('返回助手并分析')); expect(fixture.api.agent).toHaveBeenCalledTimes(1);
  fixture.api.agent.mockResolvedValueOnce({ ...agentResult, runId: 'run-feedback' });
  expect((screen.getByLabelText('输入学习问题') as HTMLTextAreaElement).value).toContain('实际提交的练习记录');
  fireEvent.click(screen.getByText('发送问题')); await waitFor(() => expect(fixture.api.agent).toHaveBeenCalledTimes(2));
  expect(fixture.api.agent.mock.calls[1][0].history).toHaveLength(2);
});
it('preserves the chosen plan time when returning from practice and keeps hidden actions inaccessible', async () => {
  render(<AssistantPage />); await submitAgent();
  const time = '2099-10-11T21:30';
  fireEvent.change(screen.getByLabelText('学习时间'), { target: { value: time } });
  fireEvent.click(screen.getByRole('button', { name: '开始针对练习 · 1 题' }));
  expect(screen.queryByRole('button', { name: '确认保存到学习计划' })).toBeNull();
  expect(screen.queryByRole('form', { name: '提交学习问题' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回助手并分析' }));
  expect((screen.getByLabelText('学习时间') as HTMLInputElement).value).toBe(time);
  expect(fixture.api.createStudyPlan).not.toHaveBeenCalled();
  expect(fixture.api.agent).toHaveBeenCalledTimes(1);
});
it('retains the saved plan marker after practice without allowing another save', async () => {
  render(<AssistantPage />); await submitAgent();
  fireEvent.click(screen.getByRole('button', { name: '确认保存到学习计划' }));
  await screen.findByText('计划已保存。');
  fireEvent.click(screen.getByRole('button', { name: '开始针对练习 · 1 题' }));
  fireEvent.click(screen.getByRole('button', { name: '返回助手并分析' }));
  expect(screen.getByRole('link', { name: '查看学习计划' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '确认保存到学习计划' })).toBeNull();
  expect(fixture.api.createStudyPlan).toHaveBeenCalledTimes(1);
});
it('retains an uncertain save after practice and verifies the original attempt before any retry', async () => {
  fixture.api.createStudyPlan.mockRejectedValue(new Error('网络中断'));
  render(<AssistantPage />); await submitAgent();
  const time = '2099-10-11T21:30';
  fireEvent.change(screen.getByLabelText('学习时间'), { target: { value: time } });
  fireEvent.click(screen.getByRole('button', { name: '确认保存到学习计划' }));
  await screen.findByText(/网络中断/);
  const attempted = fixture.api.createStudyPlan.mock.calls[0][0];
  fireEvent.click(screen.getByRole('button', { name: '开始针对练习 · 1 题' }));
  fireEvent.click(screen.getByRole('button', { name: '返回助手并分析' }));
  expect((screen.getByLabelText('学习时间') as HTMLInputElement).value).toBe(time);
  expect((screen.getByRole('button', { name: '确认保存到学习计划' }) as HTMLButtonElement).disabled).toBe(true);
  fixture.api.studyPlans.mockResolvedValue({ page: 1, pageSize: 10, total: 1, items: [{ ...attempted, planId: 'existing' }] });
  fireEvent.click(screen.getByRole('button', { name: '核对保存状态' }));
  await screen.findByText('计划已保存。');
  expect(fixture.api.createStudyPlan).toHaveBeenCalledTimes(1);
});
it('guards synchronous duplicate sends, keeps failure draft and avoids repeated user messages on retry', async () => {
  let reject: (reason: unknown) => void = () => undefined;
  fixture.api.agent.mockImplementationOnce(() => new Promise<AgentResult>((_resolve, failure) => { reject = failure; }));
  render(<AssistantPage />); await agentMode(); fireEvent.change(await screen.findByLabelText('输入学习问题'), { target: { value: '失败目标' } });
  const form = screen.getByRole('form', { name: '提交学习问题' }); fireEvent.submit(form); fireEvent.submit(form);
  expect(fixture.api.agent).toHaveBeenCalledTimes(1); expect((screen.getByLabelText('选择学习资料') as HTMLSelectElement).disabled).toBe(true);
  await act(async () => reject(new ApiClientError('服务失败', 503, 'AI_UNAVAILABLE'))); await screen.findByRole('alert');
  expect((screen.getByLabelText('输入学习问题') as HTMLTextAreaElement).value).toBe('失败目标');
  fireEvent.submit(form); await screen.findByText(agentResult.answer); expect(screen.getAllByText('失败目标')).toHaveLength(1);
});
it('clears Agent state on scope or mode switch and ignores responses after unmount', async () => {
  fixture.api.contents.mockResolvedValue(contentList([content('lesson-1', '课程甲', '已就绪', 'completed'), content('lesson-2', '课程乙', '已就绪', 'completed')]));
  const view = render(<AssistantPage />); await submitAgent(); fireEvent.change(screen.getByLabelText('选择学习资料'), { target: { value: 'lesson-2' } });
  expect(screen.queryByText(agentResult.answer)).toBeNull(); fireEvent.click(screen.getByText('资料问答')); expect(screen.queryByLabelText('可用分钟')).toBeNull();
  fireEvent.click(screen.getByText('学习 Agent'));
  let resolve: (result: AgentResult) => void = () => undefined; fixture.api.agent.mockImplementationOnce(() => new Promise<AgentResult>((success) => { resolve = success; }));
  fireEvent.change(screen.getByLabelText('输入学习问题'), { target: { value: '目标' } }); fireEvent.click(screen.getByText('发送问题')); view.unmount();
  await act(async () => resolve(agentResult)); expect(screen.queryByText(agentResult.answer)).toBeNull();
});
