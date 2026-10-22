import Link from 'next/link';
import type { ReactElement } from 'react';

/** Public notice only. No account, paper, timer or answer data is loaded. */
export function ExamRetiredPage(): ReactElement {
  return <main className="flex min-h-screen items-center justify-center bg-bg px-5 py-12 text-text">
    <section aria-labelledby="exam-retired-title" className="w-full max-w-xl rounded-2xl border border-glass-line bg-surface p-6 shadow-sm sm:p-10">
      <p className="text-sm text-textSub">文豪 · 学习空间</p>
      <h1 id="exam-retired-title" className="mt-4 text-2xl font-bold">试卷功能已下线</h1>
      <p className="mt-4 text-sm leading-7 text-textSub">平台正在集中完善资料学习、班级作业和智能批改。这里不再提供组卷、考试作答或试卷批阅。</p>
      <p className="mt-3 text-sm leading-7 text-textSub">历史答卷与成绩仍保留，当前不提供在线查询，也不会自动转为作业或新的成绩。</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/import" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">进入学习中心</Link>
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-xl border border-glass-line px-5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">返回工作台</Link>
      </div>
    </section>
  </main>;
}
