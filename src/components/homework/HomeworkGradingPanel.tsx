'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { homework } from '@/services/homework';
import type { HomeworkQuestion, HomeworkView } from '@/lib/homework/contracts';
import type { HomeworkCorrectionAttempt, HomeworkGradingItem, HomeworkGradingReport, ReportCommand } from '@/lib/homework/grading-contracts';

type Props = { draft: HomeworkView };
const assessmentLabel: Record<HomeworkGradingItem['assessment'], string> = { correct: 'AI建议：符合', partial: 'AI建议：部分符合', incorrect: 'AI建议：不符合', needs_review: '待核验' };
const causeLabel: Record<HomeworkGradingItem['errorCause'], string> = { none: '未发现明显错因', concept: '概念理解', method: '解题方法', calculation: '计算过程', omission: '遗漏条件或步骤', expression: '表达不完整', uncertainty: '依据不足/存在不确定性' };
const stateLabel: Record<HomeworkGradingReport['state'], string> = { PENDING: '等待开始', RUNNING: '分析中', READY: '分析完成', FAILED: '分析失败', CANCELLED: '已取消' };
const correctionLabel: Record<HomeworkCorrectionAttempt['state'], string> = { RUNNING: '复核中', READY: '复核完成', FAILED: '复核失败（订正已保留）', CANCELLED: '复核已取消（订正已保留）' };
function reportKey(report: HomeworkGradingReport): string { return `${report.id}:${report.revision}`; }
function mergeReport(items: HomeworkGradingReport[], item: HomeworkGradingReport): HomeworkGradingReport[] { return [item, ...items.filter((report): boolean => report.id !== item.id)].sort((a, b): number => Date.parse(b.createdAt) - Date.parse(a.createdAt)); }
function questionAnswer(questions: HomeworkQuestion[], number: string): string { return questions.find((question): boolean => question.number === number)?.answer ?? ''; }

export function HomeworkGradingPanel({ draft }: Props): ReactElement {
  const [reports, setReports] = useState<HomeworkGradingReport[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const correctionAttempts = useRef<Map<string, { key: string; requestId: string }>>(new Map());
  const questions = draft.questions;

  const refresh = useCallback(async (): Promise<HomeworkGradingReport[]> => {
    const result = await homework.grading(draft.id);
    setReports(result.items);
    return result.items;
  }, [draft.id]);

  useEffect((): (() => void) => {
    let active = true;
    setReports(null);
    setSelected(questions.slice(0, 8).map((question): string => question.number));
    setConsent(false);
    setError('');
    void homework.grading(draft.id).then((result): void => { if (active) setReports(result.items); }).catch((reason: unknown): void => { if (active) setError(reason instanceof Error ? reason.message : '报告暂时无法读取'); });
    return (): void => { active = false; };
  }, [draft.id, questions]);

  const start = async (numbers: string[] = selected): Promise<void> => {
    if (busy || draft.state !== 'CONFIRMED' || !consent || !numbers.length || numbers.length > 8) return;
    setBusy('analysis'); setError(''); setMessage('');
    const key = JSON.stringify({ expectedDraftRevision: draft.revision, questionNumbers: numbers });
    if (!attempt.current || attempt.current.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
    try {
      const reserved = await homework.createGrading(draft.id, { requestId: attempt.current.requestId, expectedDraftRevision: draft.revision, consent: true, questionNumbers: numbers });
      setReports((current): HomeworkGradingReport[] => mergeReport(current ?? [], reserved));
      if (reserved.state === 'PENDING') {
        const result = await homework.runGrading(draft.id, reserved.id);
        setReports((current): HomeworkGradingReport[] => mergeReport(current ?? [], result));
        if (result.state === 'FAILED' || result.state === 'CANCELLED') attempt.current = null;
        setMessage(result.state === 'READY' ? '本批次建议已生成；请逐题核对依据和待核验提示。' : result.state === 'RUNNING' ? '分析仍在处理中，可取消或稍后刷新。' : '本批次没有形成可用结果，原校对与报告已保留。');
      } else if (reserved.state === 'FAILED' || reserved.state === 'CANCELLED') {
        attempt.current = null;
        setMessage('已读取这次请求的原状态。需要重试时，请明确点击失败报告中的“新建批次重试”。');
      } else setMessage(stateLabel[reserved.state]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批改暂未完成；请保留输入并刷新报告状态');
      try { await refresh(); } catch { /* Preserve the visible request error and current input. */ }
    } finally { setBusy(null); }
  };

  const cancel = async (report: HomeworkGradingReport, target: 'analysis' | 'correction', targetRequestId?: string): Promise<void> => {
    if (busy) return;
    setBusy(`cancel:${report.id}`); setError(''); setMessage('');
    try {
      const current = (await refresh()).find((item): boolean => item.id === report.id);
      if (!current) throw new Error('报告已不在列表中，请重新读取');
      const command: ReportCommand = {
        action: 'cancel', requestId: crypto.randomUUID(), expectedRevision: current.revision,
        target, ...(targetRequestId ? { targetRequestId } : {}),
      };
      const result = await homework.commandGrading(draft.id, report.id, command);
      setReports((items): HomeworkGradingReport[] => mergeReport(items ?? [], result));
      setMessage(target === 'analysis' ? '已取消该分析，迟到结果不会覆盖报告。' : '已取消该次复核；订正文本仍保留。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消未完成，请刷新当前状态后重试');
      try { await refresh(); } catch { /* Keep the cancellation failure visible. */ }
    } finally { setBusy(null); }
  };

  const correct = async (report: HomeworkGradingReport, number: string): Promise<void> => {
    if (busy || !consent) return;
    const key = `${report.id}:${number}`;
    const answer = answers[key] ?? latestAnswer(report, number, questions);
    if (!answer.trim()) { setError(`第${number}题订正不能为空`); return; }
    setBusy(`correct:${report.id}:${number}`); setError(''); setMessage('');
    const requestKey = JSON.stringify({ reportId: report.id, revision: report.revision, number, answer });
    let stored = correctionAttempts.current.get(key);
    if (!stored || stored.key !== requestKey) { stored = { key: requestKey, requestId: crypto.randomUUID() }; correctionAttempts.current.set(key, stored); }
    try {
      const command: ReportCommand = { action: 'correct', requestId: stored.requestId, expectedRevision: report.revision, consent: true, number, answer };
      const result = await homework.commandGrading(draft.id, report.id, command);
      setReports((items): HomeworkGradingReport[] => mergeReport(items ?? [], result));
      const attemptResult = result.corrections.find((item): boolean => item.requestId === stored?.requestId);
      if (attemptResult?.state === 'READY') {
        correctionAttempts.current.delete(key);
        setMessage(`第${number}题复核完成，前后答案已分别保留。`);
      } else if (attemptResult?.state === 'FAILED' || attemptResult?.state === 'CANCELLED') {
        correctionAttempts.current.delete(key);
        setMessage(`第${number}题复核未完成，订正答案仍保留；请修改后或新建复核再试。`);
      } else setMessage(`第${number}题复核状态：${attemptResult ? correctionLabel[attemptResult.state] : stateLabel[result.state]}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '订正复核暂未完成；输入已保留');
      try { await refresh(); } catch { /* Keep the correction and failure message visible. */ }
    } finally { setBusy(null); }
  };

  const toggle = (number: string, checked: boolean): void => {
    setSelected((current): string[] => checked ? current.length >= 8 ? current : [...current, number] : current.filter((item): boolean => item !== number));
  };

  const canGrade = draft.state === 'CONFIRMED';
  return <section className="dashboard-section mt-6 min-w-0" aria-labelledby="homework-grading-title">
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 id="homework-grading-title" className="text-lg font-semibold">智能批改与错因订正</h2><p className="mt-1 text-sm text-textSub">只分析这份本人确认的题目快照；AI建议不会写入班级成绩、负责人批阅或知识掌握度。</p></div><button type="button" disabled={busy !== null} onClick={(): void => { void refresh().then((): void => setError('')).catch((reason: unknown): void => setError(reason instanceof Error ? reason.message : '报告状态读取失败')); }} className="min-h-11 rounded-lg border border-glass-line px-3 py-2 text-sm disabled:opacity-50">刷新报告状态</button></header>
    {draft.state === 'ARCHIVED' && <p className="rounded-lg bg-brand-soft p-3 text-sm text-textSub">这份作业已归档，报告仅供查看，不能再发起新分析或订正。</p>}
    {draft.state !== 'ARCHIVED' && !canGrade && <p className="rounded-lg bg-brand-soft p-3 text-sm text-textSub">请先完成题目和答案校对并确认冻结，再开始批改。</p>}
    {canGrade && <div className="mb-5 rounded-xl border border-glass-line p-4">
      <h3 className="font-semibold">选择本批次题目（最多8题）</h3>
      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">{questions.map((question): ReactElement => <label key={question.number} className="flex min-h-11 min-w-0 items-start gap-2 rounded-lg border border-glass-line p-3 text-sm"><input type="checkbox" className="mt-1 shrink-0" checked={selected.includes(question.number)} disabled={busy !== null || !selected.includes(question.number) && selected.length >= 8} onChange={(event): void => toggle(question.number, event.target.checked)} /><span className="min-w-0 break-words">第{question.number}题 · {question.prompt.slice(0, 100)}{question.prompt.length > 100 ? '…' : ''}</span></label>)}</div>
      <p className="mt-3 text-xs leading-5 text-textSub">每次最多8题、合计最多16000字符。结果仅为学习建议；选择/判断规则比对只认格式明确的答案，简答题不做模糊规则判分。</p>
      <label className="mt-3 flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 shrink-0" checked={consent} disabled={busy !== null} onChange={(event): void => setConsent(event.target.checked)} /><span>我同意将选中题目、我的答案、参考答案/评分依据，以及之后提交的订正答案发送给星火 Lite 生成学习建议。</span></label>
      <button type="button" disabled={busy !== null || !consent || selected.length === 0} onClick={(): void => { void start(); }} className="mt-3 min-h-11 rounded-lg bg-brand px-4 py-2 text-white disabled:opacity-50">{busy === 'analysis' ? '正在分析…' : `分析所选 ${selected.length} 题`}</button>
    </div>}
    {error && <p role="alert" className="mb-3 break-words text-rose">{error}</p>}{message && <p role="status" className="mb-3 break-words text-sm text-teal">{message}</p>}
    {!reports ? <p role="status" className="text-sm text-textSub">正在读取批改报告…</p> : reports.length === 0 ? <p className="rounded-lg bg-bg p-4 text-sm text-textSub">还没有AI批改报告。完成校对确认后，可按批次分析。</p> : <div className="space-y-4">
      {reports.map((report): ReactElement => <article id={`report-${report.id}`} key={report.id} className="min-w-0 rounded-xl border border-glass-line p-4">
        <header className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">批次 · {report.questionNumbers.map((number): string => `第${number}题`).join('、')}</h3><span className="rounded-full bg-brand-soft px-3 py-1 text-sm text-brand-ink">{stateLabel[report.state]}</span></header>
        <p className="mt-2 text-xs text-textSub">基于本人确认的第{report.sourceRevision}版题目快照 · {new Date(report.createdAt).toLocaleString()}</p>
        {report.errorCode && <p className="mt-3 rounded-lg bg-rose/10 p-3 text-sm text-rose">{homeworkError(report.errorCode)}</p>}
        {(report.state === 'PENDING' || report.state === 'RUNNING') && <button type="button" disabled={busy !== null} onClick={(): void => { void cancel(report, 'analysis'); }} className="mt-3 min-h-11 rounded-lg border border-rose px-3 py-2 text-sm text-rose disabled:opacity-50">取消本批分析</button>}
        {report.state === 'PENDING' && canGrade && <button type="button" disabled={busy !== null || !consent} onClick={(): void => { setBusy('analysis'); setError(''); void homework.runGrading(draft.id, report.id).then((result): void => { setReports((items): HomeworkGradingReport[] => mergeReport(items ?? [], result)); setMessage(result.state === 'READY' ? '本批次建议已生成；请逐题核对依据和待核验提示。' : `批次状态：${stateLabel[result.state]}`); }).catch((reason: unknown): void => setError(reason instanceof Error ? reason.message : '批次启动失败，请刷新状态')).finally((): void => setBusy(null)); }} className="mt-3 ml-2 min-h-11 rounded-lg border border-brand px-3 py-2 text-sm text-brand-ink disabled:opacity-50">继续此批分析</button>}
        {report.state === 'FAILED' && canGrade && <button type="button" disabled={busy !== null || !consent} onClick={(): void => { attempt.current = null; void start(report.questionNumbers); }} className="mt-3 ml-2 min-h-11 rounded-lg border border-brand px-3 py-2 text-sm text-brand-ink disabled:opacity-50">新建批次重试</button>}
        {report.result && <div className="mt-4 space-y-3">{report.result.items.map((item): ReactElement => <section key={item.number} className="min-w-0 rounded-lg bg-bg p-3">
          <header className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">第{item.number}题</h4><strong className={item.assessment === 'needs_review' ? 'text-rose' : 'text-brand-ink'}>{assessmentLabel[item.assessment]}{item.suggestedScore !== null ? ` · ${item.suggestedScore}/100` : ''}</strong></header>
          <p className="mt-2 text-sm leading-6"><span className="font-medium">错因：</span>{causeLabel[item.errorCause]}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{item.reason}</p>
          {item.evidenceQuote && <blockquote className="mt-2 break-words border-l-2 border-teal pl-3 text-sm text-textSub">依据摘录（本人提供，未经外部核实）：“{item.evidenceQuote}”</blockquote>}
          <p className="mt-2 text-sm leading-6"><span className="font-medium">下一步：</span>{item.nextStep}</p>
          <p className="mt-2 rounded-md bg-brand-soft p-2 text-xs text-brand-ink">规则比对：{item.objectiveMatch === 'match' ? `一致（${item.objectiveScore}/100）` : item.objectiveMatch === 'mismatch' ? `不一致（${item.objectiveScore}/100）` : '无法自动比对'} · 不是教师评分</p>
          <label className="mt-3 block text-sm">订正后的答案<textarea rows={3} maxLength={2000} disabled={!canGrade || busy !== null} value={answers[`${report.id}:${item.number}`] ?? latestAnswer(report, item.number, questions)} onChange={(event): void => setAnswers((current): Record<string, string> => ({ ...current, [`${report.id}:${item.number}`]: event.target.value }))} className="mt-1 block min-h-20 w-full min-w-0 rounded-lg border border-glass-line bg-surface p-3" /></label>
          <button type="button" disabled={!canGrade || busy !== null || !consent} onClick={(): void => { void correct(report, item.number); }} className="mt-2 min-h-11 rounded-lg border border-brand px-3 py-2 text-sm text-brand-ink disabled:opacity-50">{busy === `correct:${report.id}:${item.number}` ? '正在重新核对…' : '保存订正并重新核对'}</button>
          {report.corrections.filter((correction): boolean => correction.number === item.number).map((correction): ReactElement => <div key={correction.requestId} className="mt-3 rounded-lg border border-glass-line p-3 text-sm">
            <p className="font-medium">订正记录 · {correctionLabel[correction.state]}</p><p className="mt-2 break-words">订正前：{correction.beforeAnswer}</p><p className="mt-1 break-words">订正后：{correction.correctedAnswer}</p>
            {correction.result && <div className="mt-2"><p>{assessmentLabel[correction.result.assessment]}{correction.result.suggestedScore !== null ? ` · ${correction.result.suggestedScore}/100` : ''} · 错因：{causeLabel[correction.result.errorCause]}</p><p className="mt-1 whitespace-pre-wrap break-words">{correction.result.reason}</p>{correction.result.evidenceQuote && <p className="mt-1 break-words text-textSub">依据摘录：“{correction.result.evidenceQuote}”</p>}</div>}
            {correction.errorCode && <p role="alert" className="mt-2 text-rose">{homeworkError(correction.errorCode)}</p>}
            {correction.state === 'RUNNING' && <button type="button" disabled={busy !== null} onClick={(): void => { void cancel(report, 'correction', correction.requestId); }} className="mt-2 min-h-11 rounded-lg border border-rose px-3 py-2 text-rose disabled:opacity-50">取消本次复核</button>}
          </div>)}
        </section>)}</div>}
      </article>)}
    </div>}
  </section>;
}

function latestAnswer(report: HomeworkGradingReport, number: string, questions: HomeworkQuestion[]): string {
  const latest = [...report.corrections].reverse().find((correction): boolean => correction.number === number);
  return latest?.correctedAnswer ?? questionAnswer(questions, number);
}
function homeworkError(code: HomeworkGradingReport['errorCode']): string {
  if (code === 'AI_TIMEOUT') return '星火响应超时；没有保存部分结果，可手动新建一批重试。';
  if (code === 'SCHEMA_INVALID') return '模型结果未通过题号/依据核验；没有保存部分结果，可核对后手动重试。';
  if (code === 'CANCELLED') return '本次请求已取消，原校对与订正均保留。';
  if (code === 'GRADING_EXPIRED') return '分析等待超时，没有自动重发；需要时可手动新建批次。';
  return '星火服务暂不可用或未配置；没有保存部分结果，可稍后手动新建批次。';
}
