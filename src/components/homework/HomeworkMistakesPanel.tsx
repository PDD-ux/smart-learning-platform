'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { homework } from '@/services/homework';
import type { HomeworkMistakeItem } from '@/lib/homework/grading-contracts';

const assessmentLabel: Record<HomeworkMistakeItem['assessment'], string> = {
  partial: '部分符合', incorrect: '需要订正', needs_review: '待核验',
};
const causeLabel: Record<HomeworkMistakeItem['errorCause'], string> = {
  none: '未发现明显错因', concept: '概念理解', method: '解题方法', calculation: '计算过程',
  omission: '遗漏条件或步骤', expression: '表达不完整', uncertainty: '依据不足/待核验',
};

export function HomeworkMistakesPanel(): ReactElement {
  const [items, setItems] = useState<HomeworkMistakeItem[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect((): (() => void) => {
    let active = true;
    setItems(null);
    setError('');
    void homework.mistakes().then((result): void => {
      if (active) setItems(result.items);
    }).catch((reason: unknown): void => {
      if (active) setError(reason instanceof Error ? reason.message : '作业错因暂时无法读取');
    });
    return (): void => { active = false; };
  }, [revision]);

  return <section aria-labelledby="homework-mistakes-title" className="dashboard-section mb-6 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="homework-mistakes-title" className="font-semibold">作业错因建议</h2><p className="mt-1 text-sm text-textSub">仅显示本人 AI 批改报告中待订正或待核验的题目。</p></div>
      <button type="button" className="min-h-11 rounded-lg border border-glass-line px-3 py-2 text-sm" onClick={(): void => setRevision((value): number => value + 1)}>重新读取</button>
    </div>
    {error && <p role="alert" className="mt-3 break-words text-sm text-rose">{error}</p>}
    {items === null ? !error && <p role="status" className="mt-3 text-sm text-textSub">正在读取作业错因…</p> : items.length === 0 ? <p className="mt-3 text-sm text-textSub">目前没有待订正的作业错因建议。</p> : <ul className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
      {items.map((item): ReactElement => <li key={`${item.draftId}:${item.reportId}:${item.number}`} className="min-w-0 rounded-lg border border-glass-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-textSub"><span className="truncate">{item.draftTitle} · 第{item.number}题</span><span className="rounded-full bg-brand-soft px-2 py-1 text-brand-ink">{assessmentLabel[item.assessment]}</span></div>
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm">{item.question}</p>
        <p className="mt-2 break-words text-sm text-textSub">错因建议：{item.reason}</p>
        <p className="mt-1 text-xs text-textSub">分类：{causeLabel[item.errorCause]}</p>
        <Link className="mt-3 inline-flex min-h-11 items-center text-sm text-brand-ink underline" href={`/homework/${encodeURIComponent(item.draftId)}#report-${encodeURIComponent(item.reportId)}`}>查看订正报告与原题 →</Link>
      </li>)}
    </ul>}
  </section>;
}
