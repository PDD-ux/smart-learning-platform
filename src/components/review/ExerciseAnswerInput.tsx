'use client';
import type { ReactElement } from 'react';
import type { Exercise } from '@/services/api';
type Props = { question: Exercise; answer: string; disabled: boolean; onChange: (answer: string) => void };
export function ShortAnswerGradingNotice({ id }: { id?: string }): ReactElement {
  return <p id={id} className="mt-2 text-sm leading-6 text-textSub">简答按文字匹配判分：去首尾空白、连续空白合并、忽略大小写后，须与标准答案完全一致。不做语义判分或部分给分，同义表达、标点差异可能不匹配；提交后可核对参考答案与资料。</p>;
}
export function ExerciseAnswerInput({ question, answer, disabled, onChange }: Props): ReactElement {
  if (question.type === 'single_choice') return <fieldset className="my-4 min-w-0"><legend>选择答案</legend>{question.options.map((option, index) => {
    const label = String.fromCharCode(65 + index);
    return <label key={`${question.exerciseId}-${index}`} className="my-2 block min-h-11 break-words rounded-lg border p-3"><input type="radio" name={`answer-${question.exerciseId}`} disabled={disabled} checked={answer === label} onChange={() => onChange(label)} /> {label}. {option}</label>;
  })}</fieldset>;
  if (question.type === 'true_false') return <fieldset className="my-4"><legend>判断答案</legend><div className="mt-2 flex gap-3">{([{ value: 'true', label: '正确' }, { value: 'false', label: '错误' }] as const).map((item) => <button key={item.value} type="button" disabled={disabled} aria-pressed={answer === item.value} onClick={() => onChange(item.value)} className={`min-h-11 rounded-lg border px-5 py-2 disabled:opacity-50 ${answer === item.value ? 'border-brand bg-brand-soft text-brand-ink' : 'border-glass-line'}`}>{item.label}</button>)}</div></fieldset>;
  const noticeId = `grading-${question.exerciseId}`;
  return <div className="my-4"><label className="block">你的答案<textarea aria-describedby={noticeId} disabled={disabled} maxLength={2000} value={answer} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label><ShortAnswerGradingNotice id={noticeId} /></div>;
}
