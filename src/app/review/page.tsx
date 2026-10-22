'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app/AppShell';
import { ExerciseSourcePanel } from '@/components/review/ExerciseSourcePanel';
import { useReviewSession } from '@/components/review/useReviewSession';
import { ReviewNextSteps, type RecordedReview } from '@/components/review/ReviewNextSteps';
import { api, type Flashcard, type Profile } from '@/services/api';
const RATINGS = ['忘记', '模糊', '记住', '熟练'];

function RelatedPractice({ card }: { card: Flashcard }): ReactElement {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCount(null); setError('');
    if (!card.pointId) { setCount(0); return; }
    void api.exercises({ contentId: card.contentId, pointId: card.pointId, page: 1 }).then((result): void => {
      if (active) setCount(result.total);
    }).catch((reason: unknown): void => { if (active) setError(reason instanceof Error ? reason.message : '关联练习加载失败'); });
    return (): void => { active = false; };
  }, [card.contentId, card.pointId, revision]);
  const target = card.pointId ? `/question-bank?contentId=${encodeURIComponent(card.contentId)}&pointId=${encodeURIComponent(card.pointId)}` : '/question-bank';
  return <section aria-label="对应练习" className="rounded-xl border border-glass-line bg-surface p-5">
    <h3 className="font-semibold">做题验证</h3>
    <p className="mt-2 text-sm text-textSub">熟悉度由你自评；正式作答后的判分在题库查看。</p>
    {error ? <><p role="alert" className="mt-3 text-sm text-rose">{error}</p><button type="button" className="mt-2 min-h-11 text-brand-ink" onClick={() => setRevision((value): number => value + 1)}>重新加载关联练习</button></>
      : count === null ? <p role="status" className="mt-3 text-sm text-textSub">正在读取已有练习…</p>
        : <><p className="mt-3 text-sm">{card.pointId ? count ? `该知识点有 ${count} 道已有题目。` : '该知识点暂无已有题目。' : '当前自测项没有关联知识点，可浏览题库。'}</p>
          <Link href={target} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-brand px-4 text-sm text-brand-ink">{count ? '练习这个知识点' : '前往题库查看'}</Link></>}
    <p className="mt-3 text-xs text-textMute">读取已有题目，不调用 AI 生成。</p>
  </section>;
}

function ReviewWorkspace({ initialCards, initialProfile }: { initialCards: Flashcard[]; initialProfile: Profile }): ReactElement {
  const [cards, setCards] = useState(initialCards);
  const [selectedId, setSelectedId] = useState(initialCards[0]?.flashcardId ?? '');
  const [revealed, setRevealed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [recorded, setRecorded] = useState<RecordedReview[]>([]);
  const pending = useRef(false);
  const current = cards.find((card): boolean => card.flashcardId === selectedId) ?? cards[0];
  const session = useReviewSession({ streak: 0, xp: initialProfile.xpTotal, level: initialProfile.currentLevel, todayProgress: { done: 0, total: initialCards.length } });
  const { applyReviewResponse } = session;
  const select = (cardId: string): void => {
    if (pending.current || cardId === current?.flashcardId) return;
    setSelectedId(cardId); setRevealed(false); setError('');
  };
  const rate = useCallback(async (rating: number): Promise<void> => {
    if (!current || !revealed || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await api.review(current.flashcardId, rating);
      applyReviewResponse(result);
      setRecorded((records): RecordedReview[] => [...records, { card: current, rating, nextReviewAt: result.nextReviewAt }]);
      const date = new Date(result.nextReviewAt);
      setFeedback(`已记录“${RATINGS[rating]}”${Number.isFinite(date.getTime()) ? `，下次复习：${date.toLocaleString('zh-CN')}` : ''}。本次获得 ${result.xpGain} XP。`);
      const remaining = cards.filter((card): boolean => card.flashcardId !== current.flashcardId);
      setCards(remaining); setSelectedId(remaining[0]?.flashcardId ?? ''); setRevealed(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '熟悉度记录失败，请手动重试'); }
    finally { pending.current = false; setBusy(false); }
  }, [current, revealed, cards, applyReviewResponse]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!busy) setRevealed((value) => !value);
        return;
      }
      if (event.key >= '1' && event.key <= '4') {
        const rating = Number(event.key) - 1;
        if (!revealed) {
          setFeedback('请先按空格查看要点，再选择熟悉度。');
          return;
        }
        void rate(rating);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [revealed, busy, rate]);
  return <>
    <div className="mb-5 flex flex-wrap items-center gap-3 text-sm"><span className="rounded-full bg-brand-soft px-4 py-2 text-brand-ink">待复习 {cards.length} 项</span><span className="rounded-full bg-teal-soft px-4 py-2 text-teal">本次已记录 {session.todayProgress.done} / {session.todayProgress.total} 项</span><span className="text-textSub">{session.level} · {session.xp} XP</span></div>
    {feedback && <p role="status" className="mb-5 rounded-lg bg-teal-soft p-4 text-sm text-teal">{feedback}</p>}
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(240px,0.3fr)_minmax(0,0.7fr)]">
      <section aria-label="今日复习清单" className="dashboard-section min-w-0 self-start"><h2 className="text-lg font-semibold">今日复习清单</h2><p className="mt-2 text-sm text-textSub">按到期时间安排，选择一项开始回忆。</p>
        <div className="mt-4 max-h-[45vh] space-y-3 overflow-y-auto xl:max-h-[65vh]">{cards.map((card, index) => <button key={card.flashcardId} type="button" disabled={busy} aria-pressed={current?.flashcardId === card.flashcardId} onClick={() => select(card.flashcardId)} className={`min-h-11 w-full min-w-0 rounded-xl border p-4 text-left disabled:opacity-50 ${current?.flashcardId === card.flashcardId ? 'border-brand bg-brand-soft' : 'border-glass-line bg-surface'}`}><span className="block break-words text-sm font-medium">{index + 1}. {card.pointTitle ?? card.front}</span><span className="mt-2 block break-words text-xs text-textSub">{card.contentTitle ?? '资料标题暂不可用'}</span></button>)}{!cards.length && <p className="py-5 text-sm text-textSub">当前清单已清空。</p>}</div>
      </section>
      <section aria-label="当前知识点自测" className="min-w-0 space-y-5">
        {current ? <><div className="dashboard-section min-w-0 break-words"><p className="text-sm text-brand-ink">{current.contentTitle ?? '知识点自测'}</p><h2 className="mt-2 text-xl font-semibold">{current.pointTitle ?? '先回忆，再核对'}</h2><p className="mt-5 whitespace-pre-wrap text-lg leading-8">{current.front}</p>
          <label htmlFor="review-recall" className="mt-5 block text-sm font-medium">我的回忆（可选，仅保留在本页）</label><textarea id="review-recall" disabled={busy} maxLength={2000} value={drafts[current.flashcardId] ?? ''} onChange={(event): void => setDrafts((values): Record<string, string> => ({ ...values, [current.flashcardId]: event.target.value }))} className="mt-2 min-h-28 w-full min-w-0 rounded-lg border border-glass-line bg-bg p-3 text-sm outline-none focus:border-brand" placeholder="先试着用自己的话回忆，不会自动判分或保存为笔记" />
          {current.hint && <details className="mt-3 text-sm text-textSub"><summary className="flex min-h-11 cursor-pointer items-center">需要一点提示</summary><p className="whitespace-pre-wrap break-words">{current.hint}</p></details>}
          <button type="button" disabled={busy} aria-expanded={revealed} onClick={(): void => setRevealed((value): boolean => !value)} className="mt-4 min-h-11 rounded-lg bg-brand px-5 text-sm text-white disabled:opacity-50">{revealed ? '收起要点' : '查看要点'}</button>
          {revealed && <div className="mt-5 rounded-xl bg-teal-soft p-4"><h3 className="font-semibold text-teal">参考要点</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{current.back}</p></div>}
          <p className="mt-5 text-sm text-textSub">{revealed ? '核对后选择熟悉度，这是自评，不代表答题判分。' : '先回忆并查看要点，再记录熟悉度。'}</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{RATINGS.map((label, rating) => <button key={label} type="button" disabled={busy || !revealed} onClick={(): void => { void rate(rating); }} className={`min-h-11 rounded-lg border px-3 py-3 text-sm disabled:opacity-40 ${rating === 0 ? 'border-rose/40 text-rose' : rating === 3 ? 'border-brand bg-brand-soft text-brand-ink' : 'border-glass-line text-textSub'}`}>{rating} · {label}</button>)}</div>
          {error && <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-rose">{error}</p>}
        </div>{revealed && (current.pointId ? <ExerciseSourcePanel key={current.flashcardId} contentId={current.contentId} pointId={current.pointId} correct={true} /> : <p className="rounded-xl border border-glass-line p-4 text-sm text-textSub">当前自测项没有关联知识点，无法提供精确来源。</p>)}<RelatedPractice key={`practice-${current.flashcardId}`} card={current} /></>
          : <div className="dashboard-section py-12 text-center"><h2 className="text-xl font-semibold">{session.todayProgress.done ? '本次复习完成' : '暂无到期知识点'}</h2><p className="mt-3 text-sm text-textSub">{session.todayProgress.done ? '熟悉度已记录，下次安排按复习排期更新。' : '可以继续学习资料，或到题库做题巩固。'}</p><div className="mt-5 flex flex-wrap justify-center gap-4"><Link href="/import" className="inline-flex min-h-11 items-center text-brand-ink">继续学习</Link><Link href="/question-bank" className="inline-flex min-h-11 items-center text-brand-ink">进入题库</Link></div>{recorded.length > 0 && <div className="mt-6"><ReviewNextSteps records={recorded} /></div>}</div>}
      </section>
    </div>
  </>;
}

function ReviewPageContent(): ReactElement {
  const searchParams = useSearchParams();
  const contentId = searchParams.get('contentId') ?? undefined;
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCards(null); setProfile(null); setLoadedScope(null); setError('');
    void Promise.allSettled([api.flashcards(true, contentId), api.profile()]).then(([cardResult, profileResult]): void => {
      if (!active) return;
      if (cardResult.status === 'fulfilled') setCards(cardResult.value.items); else setError(cardResult.reason instanceof Error ? cardResult.reason.message : '复习清单暂不可用');
      if (profileResult.status === 'fulfilled') setProfile(profileResult.value); else setError(profileResult.reason instanceof Error ? profileResult.reason.message : '学习档案暂不可用');
      setLoadedScope(contentId ?? '');
    });
    return (): void => { active = false; };
  }, [contentId, revision]);
  const sameScope = loadedScope === (contentId ?? '');
  return <>{contentId && <p className="mb-5 rounded-lg bg-brand-soft p-4 text-sm text-brand-ink">正在复习所选资料的到期知识点。<Link href="/review" className="ml-3 inline-flex min-h-11 items-center underline">查看全部复习</Link></p>}{sameScope && error ? <div role="alert" className="rounded-xl bg-rose-soft p-5 text-rose">{error}<button type="button" className="ml-4 min-h-11 underline" onClick={(): void => setRevision((value): number => value + 1)}>重新加载复习</button></div> : sameScope && cards && profile ? <ReviewWorkspace key={contentId ?? 'all'} initialCards={cards} initialProfile={profile} /> : <p role="status" className="py-16 text-center text-textSub">正在准备复习清单…</p>}</>;
}
export default function ReviewPage(): ReactElement {
  return <AppShell title="复习巩固" subtitle="回忆知识、核对要点、做题验证，再回到课堂。"><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">复习巩固</h1><p className="mt-2 text-sm text-textSub">回忆知识 → 核对要点 → 做题验证 → 回看课堂</p></div><Link href="/question-bank?status=wrong" className="inline-flex min-h-11 items-center text-sm text-brand-ink">去题库重练错题 →</Link></div><Suspense fallback={<p role="status">正在准备复习清单…</p>}><ReviewPageContent /></Suspense></AppShell>;
}
