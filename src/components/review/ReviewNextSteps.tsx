import Link from 'next/link';
import type { ReactElement } from 'react';
import type { Flashcard } from '@/services/api';

export type RecordedReview = { card: Flashcard; rating: number; nextReviewAt: string };
const ratings = ['忘记', '模糊', '记住', '熟练'];

function nextDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '排期暂不可用，请稍后重新查看复习清单';
}

export function ReviewNextSteps({ records }: { records: RecordedReview[] }): ReactElement {
  const priority = records.filter((record): boolean => record.rating <= 1);
  return <section aria-label="复习后下一步" className="dashboard-section text-left">
    <h3 className="text-lg font-semibold">接下来怎么巩固</h3>
    <p className="mt-2 text-sm leading-6 text-textSub">刚才完成的是熟悉度自评，不代表客观测验通过。先回看原文，再用已有练习验证；本页不会自动出题或创建计划。</p>
    {priority.length ? <><p className="mt-4 text-sm font-medium">本次自评“忘记／模糊”的 {priority.length} 项，建议优先巩固：</p><ul className="mt-3 space-y-3">{priority.map(({ card, rating }): ReactElement => {
      const practice = `/question-bank?contentId=${encodeURIComponent(card.contentId)}${card.pointId ? `&pointId=${encodeURIComponent(card.pointId)}` : ''}`;
      return <li key={card.flashcardId} className="rounded-lg border border-glass-line p-4"><p className="break-words font-medium">{card.pointTitle ?? card.front} · 自评{ratings[rating]}</p><p className="mt-1 text-xs text-textSub">{card.contentTitle ?? '所属资料'}</p><div className="mt-2 flex flex-wrap gap-3"><Link href={`/study/${encodeURIComponent(card.contentId)}`} className="inline-flex min-h-11 items-center text-sm text-brand-ink">回看这份资料</Link><Link href={practice} className="inline-flex min-h-11 items-center text-sm text-brand-ink">{card.pointId ? '查看对应知识点练习' : '浏览这份资料的题库'}</Link></div><p className="text-xs text-textMute">题目是否可用以题库实际列表为准。</p></li>;
    })}</ul></> : <p className="mt-4 text-sm text-textSub">本次没有自评“忘记／模糊”的项目；仍可通过题库验证，按下次安排复习。</p>}
    <details className="mt-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">本次记录与下次安排 · {records.length} 项</summary><ul className="mt-2 space-y-3">{records.map(({ card, rating, nextReviewAt }): ReactElement => <li key={card.flashcardId} className="rounded-lg bg-bg p-3 text-sm"><p className="break-words">{card.pointTitle ?? card.front} · 自评{ratings[rating]}</p><p className="mt-1 text-xs text-textSub">下次安排：{nextDate(nextReviewAt)}（北京时间）</p></li>)}</ul></details>
  </section>;
}
