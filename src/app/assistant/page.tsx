'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { isRoutePromise } from '@/lib/domain/route-params';

import { AppShell } from '@/components/app/AppShell';
import { AgentActions } from '@/components/assistant/AgentActions';
import { ExercisePracticeGroup } from '@/components/review/ExercisePracticeGroup';
import { studyCitationUrl } from '@/lib/domain/study-location';
import { resolveContentSelection } from '@/lib/domain/content-selection';
import { api, ApiClientError, type AgentResult, type ContentSummary, type NoteItem, type QaResult } from '@/services/api';

type AssistantMessage =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content: string; citations: QaResult['citations']; agent?: AgentResult };

function citationLabel(ref: NoteItem['ref']): string {
  if (ref.type === 'video') {
    const minutes = Math.floor(ref.timestampSec / 60);
    const seconds = String(ref.timestampSec % 60).padStart(2, '0');
    return '视频 ' + minutes + ':' + seconds;
  }
  return '第 ' + ref.page + ' 页';
}

function assistantErrorMessage(reason: unknown): string {
  if (reason instanceof ApiClientError) {
    if (reason.code === 'NO_UNDERSTANDING') return '这份资料暂时没有可用的解析依据，请稍后再试。';
    if (reason.code === 'RATE_LIMITED') return '提问太频繁了，请稍后再试。';
    // 后端已按具体错误码返回可区分的文案（见 src/lib/ai/failure-message.ts），此处不再统一覆盖。
    if (reason.code === 'AI_UNAVAILABLE') return reason.message;
    if (reason.code === 'CONTENT_BLOCKED') return '回答未通过内容安全检查，请换个问法。';
  }
  return reason instanceof Error ? reason.message : '提问失败，请稍后重试。';
}

const suggestedQuestions = ['这份资料的核心内容是什么？', '请解释一个关键概念。', '有哪些容易混淆的要点？'];
const learningScenarios = [
  { title: '核对原文', description: '说出不理解的概念，先看原文依据再理解。', question: '请根据所选资料，解释一个容易混淆的要点，列出适用条件和原文依据；资料未提到的内容请明确说明。' },
  { title: '诊断练习', description: '根据实际作答找需要巩固的地方；无记录不推测薄弱点。', question: '请核对我在所选资料中的实际练习记录，指出需要巩固的知识点并挑选已有练习；没有记录时请说明，并建议先做哪些题。' },
  { title: '安排复习', description: '按可用分钟预览步骤，确认后才保存为计划。', question: '请结合所选资料和真实学习记录，在我的时间预算内安排复习步骤，附原文回看和已有练习；没有记录时不要推测掌握情况。' },
] as const;

function AssistantWorkspace({ searchParams = {} }: { searchParams?: { contentId?: string | string[] } } = {}): ReactElement {
  const requestedContent = searchParams.contentId;
  const appliedSelection = useRef<unknown>(Symbol());
  const [selectionError, setSelectionError] = useState('');
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [selectedContentId, setSelectedContentId] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [isLoadingContents, setIsLoadingContents] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [questionError, setQuestionError] = useState('');
  const [mode, setMode] = useState<'agent' | 'qa'>('qa');
  const [minutes, setMinutes] = useState(20);
  const [practice, setPractice] = useState<AgentResult | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const messageSequence = useRef(0);
  const pending = useRef(false);
  const active = useRef(true);
  const loadVersion = useRef(0);

  const loadContents = useCallback(async (): Promise<void> => {
    setIsLoadingContents(true);
    setLoadError('');
    const version = ++loadVersion.current;
    try {
      const result = await api.contents();
      if (!active.current || version !== loadVersion.current) return;
      const readyContents = result.items.filter((item) => item.status === '已就绪' && item.understandingStatus === 'completed');
      setContents(readyContents);
      if (appliedSelection.current !== requestedContent) {
        const selection = resolveContentSelection(readyContents, requestedContent, true);
        setSelectedContentId(selection.contentId); setSelectionError(selection.error); appliedSelection.current = requestedContent;
        setMessages([]); setQuestion(''); setQuestionError(''); setPractice(null);
      } else setSelectedContentId((currentId): string => readyContents.some((item): boolean => item.contentId === currentId) ? currentId : '');
    } catch (reason) {
      if (!active.current || version !== loadVersion.current) return;
      setLoadError(reason instanceof Error ? reason.message : '学习资料暂时无法加载。');
    } finally {
      if (active.current && version === loadVersion.current) setIsLoadingContents(false);
    }
  }, [requestedContent]);

  useEffect(() => {
    active.current = true;
    void loadContents();
    return () => { active.current = false; loadVersion.current += 1; };
  }, [loadContents]);

  const selectedContent = contents.find((item) => item.contentId === selectedContentId) ?? null;

  const selectContent = (contentId: string): void => {
    if (contentId === selectedContentId || pending.current || actionBusy || practice) return;
    setSelectedContentId(contentId);
    setSelectionError('');
    setMessages([]);
    setQuestion('');
    setQuestionError('');
  };

  const submitQuestion = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const submittedQuestion = question.trim();
    const contentId = selectedContentId;
    if (!submittedQuestion || !contentId || pending.current || actionBusy || practice) return;
    if (mode === 'agent' && (!Number.isInteger(minutes) || minutes < 5 || minutes > 120)) { setQuestionError('时间预算需为5至120分钟的整数。'); return; }

    pending.current = true;
    messageSequence.current += 1;
    const messageId = 'user-' + messageSequence.current;
    const last = messages[messages.length - 1];
    if (last?.role !== 'user' || last.content !== submittedQuestion) setMessages((currentMessages) => [...currentMessages, { id: messageId, role: 'user', content: submittedQuestion }]);
    setQuestion('');
    setQuestionError('');
    setIsSending(true);
    try {
      const result = mode === 'agent' ? await api.agent({ contentId, message: submittedQuestion, minutes, history: messages.filter((message, index) => !(index === messages.length - 1 && message.role === 'user' && message.content === submittedQuestion)).slice(-6).map((message) => ({ role: message.role, content: message.content.slice(0, 1500) })) }) : await api.qa(contentId, submittedQuestion);
      if (!active.current) return;
      setMessages((currentMessages) => [...currentMessages, {
        id: 'runId' in result ? result.runId : result.qaId,
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        ...('runId' in result ? { agent: result } : {}),
      }]);
    } catch (reason) {
      if (!active.current) return;
      setQuestion(submittedQuestion);
      setQuestionError(assistantErrorMessage(reason));
    } finally {
      pending.current = false;
      if (active.current) setIsSending(false);
    }
  };

  return (
    <AppShell compactNavigation title="AI 学习助手" subtitle="围绕所选资料提问，并核对原文出处。">
      <div className="mx-auto w-full min-w-0 max-w-[960px]">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">AI 学习助手</h1>
        <p className="mt-2 text-sm leading-6 text-textSub">选择资料，提出具体问题，再点击出处回看原文。</p>
      </header>

      <section className="dashboard-section" aria-label="AI 学习问答">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">资料与目标</h2>
            <p className="mt-1 text-sm leading-6 text-textSub">只使用本人已解析的资料；切换资料或模式会清空本次会话。</p>
          </div>
          {isLoadingContents ? <span role="status" className="text-sm text-textSub">正在载入资料…</span> : null}
        </div>

        {loadError ? (
          <div role="alert" className="mt-4 rounded-xl border border-rose/30 bg-rose-soft p-4 text-sm text-rose">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadContents()} className="mt-3 rounded-lg border border-current px-3 py-2">重新载入</button>
          </div>
        ) : null}

        {!isLoadingContents && !loadError && contents.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-glass-line bg-surface p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-2xl text-brand-ink" aria-hidden="true">✦</div>
            <h3 className="mt-4 font-semibold">还没有可用于问答的资料</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-textSub">先导入资料并等待解析完成，助手才能根据真实内容回答并标注出处。</p>
            <Link href="/import" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 py-2 text-sm font-medium text-bg">前往导入资料</Link>
          </div>
        ) : null}

        {!isLoadingContents && !loadError && contents.length > 0 && !selectedContent && <div className="mt-4 rounded-xl border border-glass-line p-4"><p role="alert" className="text-sm text-rose">{selectionError || '请选择本人可用的学习资料。'}</p><label className="mt-3 block text-sm">选择学习资料<select value="" onChange={(event): void => selectContent(event.target.value)} className="mt-2 block min-h-12 w-full rounded-xl border border-glass-line p-3"><option value="">请选择资料</option>{contents.map((item): ReactElement => <option key={item.contentId} value={item.contentId}>{item.title}</option>)}</select></label></div>}
        {!isLoadingContents && !loadError && contents.length === 0 && selectionError && <p role="alert" className="mt-3 text-sm text-rose">{selectionError}</p>}

        {!isLoadingContents && !loadError && selectedContent ? (
          <>
            <div className="mt-5 grid min-w-0 gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_auto] min-[900px]:items-end">
            <label htmlFor="assistant-content" className="block min-w-0 text-sm font-medium">
              选择学习资料
              <select
                id="assistant-content"
                value={selectedContentId}
                disabled={isSending || actionBusy || !!practice}
                onChange={(event) => selectContent(event.target.value)}
                className="mt-2 block min-h-12 w-full min-w-0 rounded-xl border border-glass-line bg-surface px-3 py-3 text-sm text-text disabled:opacity-60"
              >
                {contents.map((item) => (
                  <option key={item.contentId} value={item.contentId}>{item.title}</option>
                ))}
              </select>
            </label>

            <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-textSub">更多学习工具 · {mode === 'qa' ? '当前为资料问答' : '当前为练习与复习建议'}</summary><div className="flex flex-wrap items-center gap-3" aria-label="助手模式">
              {(['agent', 'qa'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} disabled={isSending || actionBusy || !!practice} onClick={() => { if (pending.current || actionBusy || practice || mode === value) return; setMode(value); setMessages([]); setQuestion(''); setQuestionError(''); }} className={`min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50 ${mode === value ? 'border-brand bg-brand-soft text-brand-ink' : 'border-glass-line text-textSub'}`}>{value === 'agent' ? '学习 Agent' : '资料问答'}</button>)}
              {mode === 'agent' && <label className="flex items-center gap-2 text-sm">可用分钟<input aria-label="可用分钟" type="number" min={5} max={120} step={1} value={Number.isNaN(minutes) ? '' : minutes} disabled={isSending || actionBusy || !!practice} onChange={(event) => setMinutes(event.target.valueAsNumber)} className="min-h-11 w-20 rounded-lg border border-glass-line bg-surface px-2" /></label>}
            </div></details>
            </div>

            {!practice && <section aria-label="学习场景引导" className="mt-5">
              <h3 className="text-sm font-semibold">{mode === 'agent' ? '这次想怎样学习？' : '从一个具体问题开始'}</h3>
              <p className="mt-2 text-xs leading-6 text-textSub">点击只填入问题草稿，可补充概念或自己的想法；确认后点击“发送问题”。不会自动调用AI或保存计划。</p>
              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3">
                {mode === 'agent' ? learningScenarios.map((scenario) => <button key={scenario.title} type="button" disabled={isSending || actionBusy} onClick={() => { if (pending.current || actionBusy) return; setQuestion(scenario.question); setQuestionError(''); }} className="min-h-11 min-w-0 rounded-xl border border-glass-line p-4 text-left hover:border-brand disabled:opacity-50">
                  <span className="block font-semibold text-text">{scenario.title}</span><span className="mt-2 block text-xs leading-6 text-textSub">{scenario.description}</span>
                </button>) : suggestedQuestions.map((suggestion) => <button key={suggestion} type="button" disabled={isSending || actionBusy} onClick={() => { if (pending.current || actionBusy) return; setQuestion(suggestion); setQuestionError(''); }} className="min-h-11 min-w-0 rounded-xl border border-glass-line p-3 text-left text-sm text-textSub hover:border-brand disabled:opacity-50">{suggestion}</button>)}
              </div>
              <Link href={'/study/' + selectedContentId} className="mt-2 inline-flex min-h-11 items-center text-sm text-brand-ink underline">先查看所选资料原文 →</Link>
            </section>}

            {practice && <div className="mt-5"><ExercisePracticeGroup key={practice.runId} questions={practice.practice} exitLabel="返回助手并分析" onExit={() => { setPractice(null); setQuestion('请根据我刚才实际提交的练习记录，重新分析掌握情况并调整复习建议；如果没有新记录请说明。'); setQuestionError(''); }} /></div>}

            <div hidden={practice !== null} className="mt-6 min-w-0 border-t border-glass-line pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-glass-line pb-4">
                <div>
                  <h3 className="break-words font-semibold">{mode === 'agent' ? '本次学习对话' : '本次资料问答'}</h3>
                  <p className="mt-1 text-xs text-textSub">{mode === 'agent' ? '学习记录 → 原文依据 → 针对练习 → 反馈调整' : '内容内问答 · 回答附带原文出处'}</p>
                </div>
                <span className="rounded-full bg-brand-soft px-3 py-1 text-xs text-brand-ink">会话仅保存在当前页面</span>
              </div>

              <section aria-label="问答记录" aria-live="polite" aria-relevant="additions text" className="min-h-48 min-w-0 space-y-6">
                {messages.length === 0 ? (
                  <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
                    <span className="text-3xl text-brand-ink" aria-hidden="true">✦</span>
                    <p className="mt-3 text-sm text-textSub">{mode === 'agent' ? '告诉我学习目标，我会结合真实记录安排下一步。' : '围绕这份资料提出一个具体问题。'}</p>
                  </div>
                ) : messages.map((message) => (
                  <article key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[90%] break-words rounded-2xl rounded-br-sm bg-brand px-4 py-3 text-bg sm:max-w-[78%]' : 'min-w-0 max-w-full break-words rounded-2xl border border-glass-line bg-surface p-4 text-text sm:p-6'}>
                    <p className="mb-2 text-xs font-semibold opacity-70">{message.role === 'user' ? '我' : 'AI 学习助手'}</p>
                    {message.role === 'assistant' && message.agent && <section aria-label="学习记录" className="mb-5 rounded-xl bg-brand-soft p-4">
                      <h4 className="text-sm font-semibold text-text">学习记录</h4>
                      <p className="mt-2 text-sm leading-6 text-text">{message.agent.steps.find((step) => step.tool === 'learning_status')?.summary ?? '状态未读取'}</p>
                      <p className="mt-2 text-xs leading-5 text-textSub">下方是复习建议，完成情况以本人实际提交为准。</p>
                    </section>}
                    {message.role === 'assistant' && <h4 className="mb-2 text-sm font-semibold">{message.agent ? '学习建议' : '回答'}</h4>}
                    <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
                    {message.role === 'assistant' && message.citations.length > 0 ? (
                      <div className="mt-4 border-t border-glass-line pt-3">
                        <h4 className="mb-3 text-sm font-semibold">原文依据</h4>
                        <ul className="space-y-2">
                          {message.citations.map((citation, index) => (
                            <li key={message.id + '-citation-' + index}>
                              <div className="rounded-xl bg-brand-soft px-4 pb-4 text-sm leading-6 text-textSub">
                              <Link href={studyCitationUrl(selectedContentId, citation.ref)} className="inline-flex min-h-11 items-center hover:underline">
                                <span className="font-semibold text-brand-ink">{citationLabel(citation.ref)} · 查看学习资料</span>
                              </Link>
                              {citation.excerpt.length > 240 ? <>
                                <p><span className="font-semibold">摘录预览：</span>{citation.excerpt.slice(0, 160)}…</p>
                                <details className="mt-2">
                                  <summary className="min-h-11 cursor-pointer py-3 font-semibold text-text">展开完整原文（{citation.excerpt.length} 字）</summary>
                                  <p className="whitespace-pre-wrap leading-7">{citation.excerpt}</p>
                                </details>
                              </> : <p className="whitespace-pre-wrap">{citation.excerpt}</p>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : message.role === 'assistant' ? <div className="mt-4 rounded-xl border border-glass-line p-3 text-sm leading-6 text-textSub"><p>本次回答没有可点击的原文依据，请回到资料核对；学习记录或复习建议不等于原文证明。</p><Link href={'/study/' + selectedContentId} className="inline-flex min-h-11 items-center text-brand-ink underline">回看所选资料</Link></div> : null}
                    {message.role === 'assistant' && message.agent && <AgentActions result={message.agent} onPractice={(result) => { if (!pending.current && !actionBusy) setPractice(result); }} onBusyChange={setActionBusy} />}
                  </article>
                ))}
                {isSending ? <p role="status" className="rounded-xl bg-brand-soft p-4 text-sm leading-6 text-textSub">{mode === 'agent' ? 'Agent正在核对记录和资料、选择工具…请稍候。' : '助手正在结合资料整理回答…'}</p> : null}
              </section>

              {questionError ? <p role="alert" className="mt-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{questionError}</p> : null}

              <form aria-label="提交学习问题" onSubmit={(event) => void submitQuestion(event)} className="mt-5 border-t border-glass-line pt-4">
                <label htmlFor="assistant-question" className="mb-2 block text-sm font-semibold">输入学习问题</label>
                <textarea
                  id="assistant-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={mode === 'agent' ? 1000 : 500}
                  rows={3}
                  disabled={isSending || actionBusy}
                  placeholder={mode === 'agent' ? '例如：我想巩固这节课，帮我找依据、安排复习和练习…' : '就所选资料提问，最多 500 字…'}
                  className="w-full resize-y rounded-xl border border-glass-line bg-bg p-3 text-sm text-text outline-none focus:border-brand disabled:opacity-60"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-textMute">{question.trim().length} / {mode === 'agent' ? 1000 : 500} · 仅使用本人所选资料</span>
                  <button type="submit" disabled={isSending || actionBusy || !question.trim()} className="min-h-11 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50">
                    {isSending ? '正在回答…' : '发送问题'}
                  </button>
                </div>
              </form>
            </div>
          </>
        ) : null}
      </section>
      </div>
    </AppShell>
  );
}

type AssistantSearch = { contentId?: string | string[] };
export default function AssistantPage(props: { searchParams?: AssistantSearch }): ReactElement;
export default function AssistantPage(props: { searchParams?: Promise<AssistantSearch> }): ReactElement;
export default function AssistantPage(props: { searchParams?: AssistantSearch | Promise<AssistantSearch> }): ReactElement {
  const searchParams = isRoutePromise(props.searchParams) ? use(props.searchParams) : props.searchParams;
  return <AssistantWorkspace key={JSON.stringify(searchParams?.contentId ?? null)} searchParams={searchParams} />;
}
