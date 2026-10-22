'use client';
import { use, useEffect, useRef, useState, type ReactElement } from 'react';
import { isRoutePromise } from '@/lib/domain/route-params';
import { AppShell } from '@/components/app/AppShell';
import { ExerciseSourcePanel } from '@/components/review/ExerciseSourcePanel';
import { HomeworkMistakesPanel } from '@/components/homework/HomeworkMistakesPanel';
import { ExercisePracticeGroup } from '@/components/review/ExercisePracticeGroup';
import { ExerciseAnswerInput } from '@/components/review/ExerciseAnswerInput';
import { formatExerciseAnswer } from '@/components/review/formatExerciseAnswer';
import { api, type BankList, type BankQuestion, type ContentSummary, type Exercise } from '@/services/api';
type Result = { correct: boolean; correctAnswer: string; explanation: string };
const questionTypeLabels: Record<Exercise['type'], string> = { single_choice: '单选题', true_false: '判断题', short_answer: '简答题' };
type BankSearch = { status?: string | string[]; contentId?: string | string[]; pointId?: string | string[] };
export default function QuestionBankPage(props: { searchParams?: BankSearch }): ReactElement;
export default function QuestionBankPage(props: { searchParams?: Promise<BankSearch> }): ReactElement;
export default function QuestionBankPage(props: { searchParams?: BankSearch | Promise<BankSearch> }): ReactElement {
  const searchParams = isRoutePromise(props.searchParams) ? use(props.searchParams) : props.searchParams;
  return <QuestionBankWorkspace searchParams={searchParams} />;
}
function QuestionBankWorkspace({ searchParams }: { searchParams?: BankSearch }): ReactElement {
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [contentId, setContentId] = useState(typeof searchParams?.contentId === 'string' ? searchParams.contentId : '');
  const [pointId, setPointId] = useState(typeof searchParams?.pointId === 'string' ? searchParams.pointId : '');
  const [type, setType] = useState('');
  const [generationCount, setGenerationCount] = useState(1);
  const [status, setStatus] = useState(searchParams?.status === 'wrong' ? 'wrong' : 'all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BankList | null>(null);
  const [selected, setSelected] = useState<BankQuestion | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [group, setGroup] = useState<BankQuestion[] | null>(null);
  const requestPending = useRef(false);
  useEffect(() => { void api.contents().then((r) => setContents(r.items)).catch((e: unknown) => setError(e instanceof Error ? e.message : '资料加载失败')); }, []);
  useEffect(() => {
    let active = true; setSelected(null); setAnswer(''); setResult(null); setData(null); setError(''); setListError('');
    void api.exercises({ contentId, ...(pointId ? { pointId } : {}), type, status, page }).then((r) => { if (!active) return; const lastPage = Math.max(1, Math.ceil(r.total / r.pageSize)); if (page > lastPage) { setPage(lastPage); return; } setData(r); }).catch((e: unknown) => { if (active) setListError(e instanceof Error ? e.message : '题库加载失败'); });
    return () => { active = false; };
  }, [contentId, pointId, type, status, page, revision]);
  async function generate(): Promise<void> {
    if (!contentId) { setError('请先选择一份已完成 AI 理解的资料'); return; }
    if (requestPending.current) return;
    requestPending.current = true; setBusy(true); setError('');
    try {
      const understanding = await api.understanding(contentId);
      const pointIds = understanding.knowledgePoints.filter((p) => !pointId || p.pointId === pointId).slice(0, 20).map((p) => p.pointId);
      if (!pointIds.length) throw new Error('该资料暂无知识点，请等待 AI 理解完成');
      await api.generateExercise({ pointIds, count: generationCount, ...(type ? { type: type as Exercise['type'] } : {}) });
      setPage(1); setStatus('all'); setRevision((r) => r + 1);
    } catch (e) { setError(e instanceof Error ? e.message : '生成失败，请重试'); } finally { requestPending.current = false; setBusy(false); }
  }
  async function submit(): Promise<void> {
    if (!selected || !answer.trim() || requestPending.current || result) return;
    requestPending.current = true;
    setBusy(true); setError('');
    try {
      const r = await api.answerExercise(selected.exerciseId, answer);
      setResult(r);
      const updated = await api.exercises({ contentId, ...(pointId ? { pointId } : {}), type, status, page }); setData(updated);
      setSelected((current) => current ? { ...current, latestRecord: { userAnswer: answer, correct: r.correct, correctAnswer: r.correctAnswer, explanation: r.explanation, createdAt: new Date().toISOString() } } : null);
      const lastPage = Math.max(1, Math.ceil(updated.total / 10));
      if (page > lastPage) setPage(lastPage);
    } catch (e) { setError(e instanceof Error ? e.message : '作答失败'); } finally { requestPending.current = false; setBusy(false); }
  }
  return <AppShell title="练习题库" subtitle="选择已有练习，核对错题与原文来源。">
    <h1 className="mb-4 text-2xl font-semibold">练习题库</h1>
    <HomeworkMistakesPanel />
    {pointId && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-brand-soft px-4 py-2 text-sm text-brand-ink"><span>当前仅显示所选知识点的题目。</span><button type="button" disabled={busy || !!group} className="min-h-11 underline" onClick={(): void => { setPointId(''); setPage(1); }}>取消知识点筛选</button><a href="/review" className="inline-flex min-h-11 items-center underline">返回复习巩固</a></div>}
    {group ? <ExercisePracticeGroup questions={group} onExit={() => { setGroup(null); setRevision((value) => value + 1); }} /> : <>
    <div className="dashboard-section mb-6 flex flex-wrap items-end gap-4">
      <label className="min-w-0 basis-full text-sm xl:basis-64 xl:flex-1">资料<select disabled={busy} value={contentId} onChange={(e) => { setContentId(e.target.value); setPointId(''); setPage(1); }} className="mt-2 block min-h-11 w-full min-w-0 rounded-lg border p-2"><option value="">全部资料</option>{contents.map((c) => <option key={c.contentId} value={c.contentId}>{c.title}</option>)}</select></label>
      <label className="text-sm">题型<select disabled={busy} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="mt-2 block min-h-11 rounded-lg border p-2"><option value="">全部题型</option><option value="single_choice">单选题</option><option value="true_false">判断题</option><option value="short_answer">简答题</option></select></label>
      <label className="text-sm">状态<select disabled={busy} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="mt-2 block min-h-11 rounded-lg border p-2"><option value="all">全部题目</option><option value="unanswered">未作答</option><option value="wrong">曾经答错</option></select></label>
      <label className="text-sm">出题数量<select disabled={busy} value={generationCount} onChange={(e): void => setGenerationCount(Number(e.target.value))} className="mt-2 block min-h-11 rounded-lg border p-2"><option value={1}>1 题</option><option value={3}>3 题</option><option value={5}>5 题</option></select></label>
      <button disabled={busy} onClick={() => void generate()} className="min-h-11 rounded-lg bg-brand px-4 py-2 text-bg disabled:opacity-50">{busy ? '处理中…' : pointId ? `为当前知识点生成 ${generationCount} 题` : `为选定资料生成 ${generationCount} 题`}</button>
      <p className="basis-full text-sm text-textSub">短资料建议先生成 1 题；依据不足时不凑数，可减少题数后手动尝试。</p>
    </div>
    {error && <p role="alert" className="mb-4 text-rose">{error}</p>}
    <div className="mb-5 flex flex-wrap items-center gap-3"><button type="button" disabled={busy || !data?.items.length} onClick={() => { if (requestPending.current || !data?.items.length) return; setGroup([...new Map(data.items.map((item) => [item.exerciseId, item])).values()]); }} className="min-h-11 rounded-lg border border-brand bg-brand-soft px-4 py-2 text-brand-ink disabled:opacity-50">开始本页练习{data ? ` · ${data.items.length} 题` : ''}</button><p className="text-sm text-textSub">按当前筛选的这一页练习，完成后查看本组总结。</p></div>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]"><section aria-labelledby="bank-list-title" aria-busy={!data && !listError} className="dashboard-section min-w-0"><h2 id="bank-list-title" className="mb-4 font-semibold">题目列表{data ? ` · ${data.total} 题` : ''}</h2>
      {!data ? listError ? <div><p role="alert" className="break-words text-rose">{listError}</p><button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)} className="mt-3 min-h-11 rounded-lg border border-brand px-4 py-2 text-sm text-brand-ink disabled:opacity-50">重新加载题库</button></div> : <p role="status" className="text-textSub">正在加载题目…</p> : !data.items.length ? <p className="text-sm leading-6 text-textSub">当前筛选下暂无题目，可以选择资料后生成练习。</p> : <div className="max-h-[45vh] space-y-3 overflow-y-auto xl:max-h-[65vh]">{data.items.map((q, index) => <button type="button" disabled={busy} aria-pressed={selected?.exerciseId === q.exerciseId} aria-controls="bank-answer-panel" key={q.exerciseId} onClick={() => { setSelected(q); setAnswer(''); setResult(null); setError(''); }} className={'block min-h-11 w-full min-w-0 rounded-lg border p-3 text-left ' + (selected?.exerciseId === q.exerciseId ? 'border-brand bg-brand-soft' : 'border-glass-line')}><span className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-textSub"><span>第 {(page - 1) * (data?.pageSize ?? 10) + index + 1} 题 · {questionTypeLabels[q.type]}</span><span>{q.latestRecord ? q.latestRecord.correct ? '上次答对' : '上次答错' : '未作答'}</span></span><strong className="line-clamp-2 break-words text-sm leading-6">{q.question}</strong><small className="mt-2 block truncate text-textSub" title={`${q.contentTitle} · ${q.pointTitle}`}>{q.contentTitle} · {q.pointTitle}</small></button>)}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><button className="min-h-11 text-brand-ink disabled:opacity-50" disabled={!data || page <= 1 || busy} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button className="min-h-11 text-brand-ink disabled:opacity-50" disabled={!data || page * data.pageSize >= data.total || busy} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section><section id="bank-answer-panel" aria-labelledby="bank-answer-title" className="dashboard-section min-w-0 break-words"><h2 id="bank-answer-title" className="mb-4 font-semibold">作答区</h2>{!selected ? <p className="py-6 text-sm leading-6 text-textSub">{!data ? listError ? '题库加载失败，重试后可选择题目。' : '题目加载后，可在列表选择一道题。' : !data.items.length ? '当前筛选下暂无可练习的题目。' : '选择一道题开始练习。完整题干、选项和解析将在这里展示。'}</p> : <><div className="mb-3 flex flex-wrap gap-2 text-xs text-textSub"><span className="rounded-full bg-brand-soft px-3 py-1 text-brand-ink">{questionTypeLabels[selected.type]}</span><span className="py-1">{selected.contentTitle} · {selected.pointTitle}</span></div><h3 className="whitespace-pre-wrap break-words text-lg font-semibold leading-8">{selected.question}</h3>
      <ExerciseAnswerInput question={selected} answer={answer} disabled={busy || !!result} onChange={setAnswer} />
      <button disabled={busy || !answer.trim() || !!result} onClick={() => void submit()} className="min-h-11 rounded-lg bg-brand px-4 py-2 text-bg disabled:opacity-50">提交答案</button>
      {result && <div role="status" className="mt-4 rounded-lg bg-brand-soft p-4"><strong>{selected.type === 'short_answer' ? result.correct ? '匹配标准答案' : '未匹配标准答案' : result.correct ? '回答正确' : '还需巩固'}</strong><p>{selected.type === 'short_answer' ? '参考答案' : '正确答案'}：{formatExerciseAnswer(selected, result.correctAnswer)}</p><p className="whitespace-pre-wrap">{result.explanation}</p><button className="mt-3 min-h-11 text-brand-ink" onClick={() => { setResult(null); setAnswer(''); }}>再练一次</button></div>}
      {selected.latestRecord && <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3">查看上次作答与解析</summary><p>你的答案：{formatExerciseAnswer(selected, selected.latestRecord.userAnswer)}</p><p>{selected.type === 'short_answer' ? '参考答案' : '正确答案'}：{formatExerciseAnswer(selected, selected.latestRecord.correctAnswer)}</p><p className="whitespace-pre-wrap">{selected.latestRecord.explanation}</p></details>}
      {(result || selected.latestRecord) && <ExerciseSourcePanel key={selected.exerciseId} contentId={selected.contentId} pointId={selected.pointId} correct={result?.correct ?? selected.latestRecord?.correct ?? false} />}
    </>}</section></div></>}
  </AppShell>;
}

