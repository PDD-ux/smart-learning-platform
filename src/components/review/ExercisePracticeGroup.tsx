'use client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { api, type BankQuestion } from '@/services/api';
import { ExerciseAnswerInput, ShortAnswerGradingNotice } from './ExerciseAnswerInput';
import { ExerciseSourcePanel } from './ExerciseSourcePanel';
import { formatExerciseAnswer } from './formatExerciseAnswer';
type Result = { correct: boolean; correctAnswer: string; explanation: string };
type Props = { questions: BankQuestion[]; onExit: () => void; exitLabel?: string };
export function ExercisePracticeGroup({ questions: initialQuestions, onExit, exitLabel = '返回题库' }: Props): ReactElement {
  const [questions, setQuestions] = useState(initialQuestions);
  const [round, setRound] = useState(1);
  const [previousRound, setPreviousRound] = useState<{ total: number; correct: number; wrong: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [redoing, setRedoing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const question = questions[index];
  const completed = questions.filter((item) => results[item.exerciseId]);
  const correctCount = completed.filter((item) => results[item.exerciseId].correct).length;
  const wrong = completed.filter((item) => !results[item.exerciseId].correct);
  const canFinish = questions.length > 0 && completed.length === questions.length && !questions.some((item) => redoing[item.exerciseId]);
  const result = question && !redoing[question.exerciseId] ? results[question.exerciseId] : undefined;
  const answer = question ? answers[question.exerciseId] ?? '' : '';
  const move = (next: number): void => {
    if (pending.current || next < 0 || next >= questions.length) return;
    setIndex(next); setError(''); setFinished(false);
  };
  const submit = async (): Promise<void> => {
    if (!question || !answer.trim() || result || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const next = await api.answerExercise(question.exerciseId, answer);
      if (!active.current) return;
      setResults((current) => ({ ...current, [question.exerciseId]: next }));
      setRedoing((current) => ({ ...current, [question.exerciseId]: false }));
    } catch (reason: unknown) {
      if (active.current) setError(reason instanceof Error ? reason.message : '判分失败，请重试');
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const wrongPoints = [...new Set(wrong.map((item) => item.pointId))].map((pointId) => {
    const items = wrong.filter((item) => item.pointId === pointId);
    return { pointId, title: items[0].pointTitle, count: items.length, firstIndex: questions.findIndex((item) => item.exerciseId === items[0].exerciseId) };
  });
  const retryWrong = (): void => {
    if (pending.current || !finished || !wrong.length) return;
    setPreviousRound({ total: questions.length, correct: correctCount, wrong: wrong.length });
    setQuestions(wrong); setRound((value): number => value + 1);
    setIndex(0); setAnswers({}); setResults({}); setRedoing({}); setError(''); setFinished(false);
  };
  return <section aria-label="本组练习" className="dashboard-section">
    {previousRound && <div className="mb-4 rounded-lg border border-brand/30 bg-brand-soft p-4 text-sm"><strong>第 {round} 轮 · 仅重练上一轮错题</strong><p className="mt-2">上一轮共 {previousRound.total} 题，答对 {previousRound.correct} 题，答错 {previousRound.wrong} 题。</p><p className="mt-2 text-xs text-textSub">以下统计仅属于当前轮，订正后的正确率不代表首次成绩或知识掌握率。</p></div>}
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{finished ? '本组练习总结' : '本页练习'}</h2><p className="mt-2 text-sm text-textSub">仅统计本次启动后的作答；刷新或离开后本组进度清空，已提交的记录保留。</p></div><button type="button" disabled={busy} onClick={() => { if (!pending.current) onExit(); }} className="min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50">{exitLabel}</button></div>
    {!question ? <p className="mt-4">本页暂无可练习题目。</p> : finished ? <>
      <div role="status" className="mt-5 rounded-xl bg-brand-soft p-4"><p>本组共 {questions.length} 题，答对 {correctCount} 题，答错 {wrong.length} 题。</p><p className="mt-2 text-lg font-semibold">本组正确率 {Math.round(correctCount / questions.length * 100)}%</p><p className="mt-2 text-xs text-textSub">按每题最新成功判分统计，重做不增加题数。</p></div>
      {questions.some((item) => item.type === 'short_answer') && <div className="mt-3"><p className="text-sm text-textSub">本组正确率包含简答的文字匹配结果，不代表语义掌握率。</p><ShortAnswerGradingNotice /></div>}
      <h3 className="mt-5 font-semibold">待巩固知识点</h3>{wrongPoints.length ? <ul className="mt-3 space-y-2">{wrongPoints.map((point) => <li key={point.pointId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><span>{point.title} · {point.count} 道错题</span><button type="button" onClick={() => move(point.firstIndex)} className="min-h-11 px-3 text-brand-ink">核对错题：{point.title}</button></li>)}</ul> : <p className="mt-3 text-textSub">本组全部答对，可以继续学习或复习闪卡。</p>}
      <button type="button" onClick={() => move(0)} className="mt-5 min-h-11 rounded-lg border px-4 text-brand-ink">返回题目核对</button>
      {wrong.length > 0 && <button type="button" disabled={busy} onClick={retryWrong} className="mt-5 ml-3 min-h-11 rounded-lg bg-brand px-4 text-sm text-white disabled:opacity-50">只重练本轮错题 · {wrong.length} 题</button>}
    </> : <>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm"><span>第 {index + 1} / {questions.length} 题</span><span>本组已答 {completed.length} / {questions.length} 题</span></div><progress aria-label="本组作答进度" value={completed.length} max={questions.length} className="mt-3 h-2 w-full accent-brand" />
      <p className="mt-4 text-xs text-textSub">{question.contentTitle} · {question.pointTitle} · {question.type === 'single_choice' ? '单选题' : question.type === 'true_false' ? '判断题' : '简答题'}</p><h3 className="mt-2 whitespace-pre-wrap break-words text-lg font-semibold">{question.question}</h3>
      <ExerciseAnswerInput question={question} answer={answer} disabled={busy || !!result} onChange={(value) => setAnswers((current) => ({ ...current, [question.exerciseId]: value }))} />
      {error && <p role="alert" className="my-3 text-rose">{error}，未确认本次成功，答案已保留。</p>}
      <button type="button" disabled={busy || !answer.trim() || !!result} onClick={() => void submit()} className="min-h-11 rounded-lg bg-brand px-4 py-2 text-bg disabled:opacity-50">{busy ? '正在判分…' : '提交本题答案'}</button>
      {result && <div role="status" className="mt-4 rounded-lg bg-brand-soft p-4"><strong>{question.type === 'short_answer' ? result.correct ? '匹配标准答案' : '未匹配标准答案' : result.correct ? '回答正确' : '还需巩固'}</strong><p className="mt-2">{question.type === 'short_answer' ? '参考答案' : '正确答案'}：{formatExerciseAnswer(question, result.correctAnswer)}</p><p className="mt-2 whitespace-pre-wrap break-words">{result.explanation}</p><button type="button" disabled={busy} className="mt-3 min-h-11 text-brand-ink" onClick={() => { if (pending.current) return; setRedoing((current) => ({ ...current, [question.exerciseId]: true })); setAnswers((current) => ({ ...current, [question.exerciseId]: '' })); }}>重做本题</button></div>}
      {result && <ExerciseSourcePanel key={question.exerciseId} contentId={question.contentId} pointId={question.pointId} correct={result.correct} />}
      <div className="mt-5 flex flex-wrap gap-3 border-t border-glass-line pt-4"><button type="button" disabled={busy || index === 0} onClick={() => move(index - 1)} className="min-h-11 rounded-lg border px-4 disabled:opacity-50">上一题</button><button type="button" disabled={busy || index >= questions.length - 1} onClick={() => move(index + 1)} className="min-h-11 rounded-lg border px-4 disabled:opacity-50">下一题</button><button type="button" disabled={busy || !canFinish} onClick={() => { if (!pending.current) setFinished(true); }} className="min-h-11 rounded-lg border border-brand px-4 text-brand-ink disabled:opacity-50">查看本组总结</button></div>
    </>}
  </section>;
}
