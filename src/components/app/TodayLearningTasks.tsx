'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { api, type ContentSummary, type Progress } from '@/services/api';

type Props = {
  contents: ContentSummary[] | null;
  contentError: string;
  onRetryContents: () => void;
  dueCount: number | null;
  dueError: string;
  onRetryDue: () => void;
  preview: boolean;
};
type Resume = { content: ContentSummary; progress: Progress | null };

function positionLabel(item: Resume): string {
  const progress = item.progress;
  if (!progress?.lastStudiedAt) return '尚无学习记录，可以从头开始';
  if (progress.contentType === 'document') return `上次读到第 ${progress.page} 页`;
  const seconds = Math.floor(progress.positionSec);
  return `上次看到 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function TodayLearningTasks({ contents, contentError, onRetryContents, dueCount, dueError, onRetryDue, preview }: Props): ReactElement {
  const [resume, setResume] = useState<Resume | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState('');
  const [progressRevision, setProgressRevision] = useState(0);
  const [wrongCount, setWrongCount] = useState<number | null>(null);
  const [wrongError, setWrongError] = useState('');
  const [wrongRevision, setWrongRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setResume(null); setProgressError(''); setProgressLoading(true);
    if (!contents) return () => { active = false; };
    const ready = contents.filter((item) => item.status === '已就绪');
    if (preview || !ready.length) {
      setResume(ready[0] ? { content: ready[0], progress: null } : null);
      setProgressLoading(false);
      return () => { active = false; };
    }
    void Promise.allSettled(ready.map((item) => api.progress(item.contentId))).then((results) => {
      if (!active) return;
      const candidates: Resume[] = [];
      let failed = false;
      results.forEach((result, index) => {
        if (result.status === 'rejected') { failed = true; return; }
        const content = ready[index]; const value = result.value;
        const validPosition = value.contentType === content.contentType && (value.contentType === 'video'
          ? Number.isFinite(value.positionSec) && value.positionSec >= 0 && (content.durationSec === null || value.positionSec <= content.durationSec)
          : Number.isSafeInteger(value.page) && value.page >= 1 && (content.pageCount === null || value.page <= content.pageCount));
        if (!validPosition || (value.lastStudiedAt !== null && !Number.isFinite(Date.parse(value.lastStudiedAt)))) { failed = true; return; }
        candidates.push({ content, progress: value });
      });
      candidates.sort((a, b) => (b.progress?.lastStudiedAt ? Date.parse(b.progress.lastStudiedAt) : 0) - (a.progress?.lastStudiedAt ? Date.parse(a.progress.lastStudiedAt) : 0));
      setResume(candidates[0] ?? null);
      setProgressError(failed ? '部分续学位置未能读取，可重新加载或到学习中心选择资料。' : '');
      setProgressLoading(false);
    });
    return () => { active = false; };
  }, [contents, preview, progressRevision]);

  useEffect(() => {
    let active = true;
    setWrongCount(null); setWrongError('');
    if (preview) { setWrongCount(3); return () => { active = false; }; }
    void api.exercises({ status: 'wrong', page: 1 }).then((result) => { if (active) setWrongCount(result.total); }).catch(() => { if (active) setWrongError('错题数量暂时无法读取，请重试。'); });
    return () => { active = false; };
  }, [preview, wrongRevision]);

  const retryClass = 'mt-2 min-h-11 text-sm font-medium text-brand-ink';
  const linkClass = 'mt-4 inline-flex min-h-11 items-center rounded-lg border border-brand px-4 text-sm font-medium text-brand-ink';
  const continueCard: ReactElement = (
<article key="continueCard" className="dashboard-section min-w-0"><span className="section-kicker">继续学习</span><h3 className="mt-2 text-lg font-semibold">{progressError ? '可用的续学资料' : '接着上次的内容'}</h3>
        {contentError ? <><p role="alert" className="mt-3 text-sm text-rose">{contentError}</p><button type="button" onClick={onRetryContents} className={retryClass}>重新加载资料</button></> : !contents || progressLoading ? <p role="status" className="mt-3 text-sm text-textSub">正在读取续学位置…</p> : resume ? <><p className="mt-3 break-words font-medium">{resume.content.title}</p><p className="mt-2 text-sm text-textSub">{positionLabel(resume)}</p><Link href={preview ? '/register' : `/study/${encodeURIComponent(resume.content.contentId)}`} className={linkClass}>{resume.progress?.lastStudiedAt ? '继续学习' : '开始学习'} →</Link></> : !progressError ? <><p className="mt-3 text-sm text-textSub">{contents.length ? '资料尚未就绪，请到学习中心查看解析状态。' : '还没有学习资料，先导入一份吧。'}</p><Link href={preview ? '/register' : '/import'} className={linkClass}>前往学习中心 →</Link></> : null}
        {progressError && <><p role="alert" className="mt-3 text-sm text-rose">{progressError}</p><button type="button" onClick={() => setProgressRevision((value) => value + 1)} className={retryClass}>重新读取续学位置</button><Link href="/import" className="ml-3 inline-flex min-h-11 items-center text-sm text-brand-ink">学习中心 →</Link></>}
      </article>
  );
  const reviewCard: ReactElement = (
<article key="reviewCard" className="dashboard-section min-w-0"><span className="section-kicker">到期自测项</span><h3 className="mt-2 text-lg font-semibold">把学过的知识留下来</h3>
        {dueError ? <><p role="alert" className="mt-3 text-sm text-rose">{dueError}</p><button type="button" onClick={onRetryDue} className={retryClass}>重新加载到期自测项</button></> : dueCount === null ? <p role="status" className="mt-3 text-sm text-textSub">正在读取到期自测项…</p> : <><p className="mt-3 text-2xl font-semibold">{dueCount} <span className="text-sm font-normal">项待复习</span></p><p className="mt-2 text-sm text-textSub">{dueCount > 0 ? '按遗忘曲线安排，只统计当前到期的自测项。' : '当前没有到期自测项，可以继续学习。'}</p><Link href={preview ? '/register' : '/review'} className={linkClass}>{dueCount > 0 ? '开始复习' : '查看复习'} →</Link></>}
      </article>
  );
  const wrongCard: ReactElement = (
<article key="wrongCard" className="dashboard-section min-w-0"><span className="section-kicker">错题巩固</span><h3 className="mt-2 text-lg font-semibold">回到没弄懂的地方</h3>
        {wrongError ? <><p role="alert" className="mt-3 text-sm text-rose">{wrongError}</p><button type="button" onClick={() => setWrongRevision((value) => value + 1)} className={retryClass}>重新加载错题</button></> : wrongCount === null ? <p role="status" className="mt-3 text-sm text-textSub">正在读取错题数量…</p> : <><p className="mt-3 text-2xl font-semibold">{wrongCount} <span className="text-sm font-normal">道曾经答错</span></p><p className="mt-2 text-sm text-textSub">{wrongCount > 0 ? '包含曾经答错、后来答对的题，可结合知识点与来源核对。' : '尚无错题记录，可以到题库开始练习。'}</p><Link href={preview ? '/register' : wrongCount > 0 ? '/question-bank?status=wrong' : '/question-bank'} className={linkClass}>{wrongCount > 0 ? '巩固错题' : '进入题库'} →</Link></>}
      </article>
  );
  return <section aria-labelledby="today-tasks-title" className="mb-6">
    <div className="section-heading"><div><span className="section-kicker">TODAY&apos;S NEXT STEP</span><h2 id="today-tasks-title" className="section-title">今日学习任务</h2><p className="section-description">有到期项先复习，再继续学或巩固错题。这里的待办量不是今日完成成绩。{preview ? '以下为免登录示例数据。' : ''}</p></div>{preview && <Link href="/register" className="section-link inline-flex min-h-11 items-center">注册后安排学习 →</Link>}</div>
    <div className="mt-4 grid gap-4 min-[1100px]:grid-cols-3">
      {dueCount !== null && dueCount > 0 && !dueError ? [reviewCard, continueCard, wrongCard] : [continueCard, reviewCard, wrongCard]}
    </div>
  </section>;
}
