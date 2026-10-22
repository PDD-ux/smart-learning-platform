'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';

import { DailyCheckInCard } from '@/components/app/DailyCheckInCard';
import { AppShell } from '@/components/app/AppShell';
import { PlanReminders } from '@/components/app/PlanReminders';
import { TodayLearningTasks } from '@/components/app/TodayLearningTasks';
import { LearningGuide } from '@/components/app/LearningGuide';
import { api, type ContentSummary, type MasteryItem, type WeakPoint } from '@/services/api';

type StatCardProps = {
  label: string;
  value: string | number;
  hint: string;
  color: string;
  onRetry?: () => void;
};

function StatCard({ label, value, hint, color, onRetry }: StatCardProps): ReactElement {
  const style = { '--stat-color': color } as CSSProperties;
  return (
    <article className="dashboard-stat" style={style}>
      <div className="dashboard-stat-top">
        <span className="dashboard-stat-label">{label}</span>
        <span className="dashboard-stat-dot" />
      </div>
      <strong className="dashboard-stat-value">{value}</strong>
      <p className="dashboard-stat-hint">{hint}</p>
      {onRetry && <button type="button" className="min-h-11 text-sm text-brand-ink underline" onClick={onRetry}>重试{label}</button>}
    </article>
  );
}

function ContentIcon({ type }: { type: ContentSummary['contentType'] }): ReactElement {
  return <span className={`content-thumb ${type === 'video' ? 'content-thumb-video' : 'content-thumb-document'}`}>{type === 'video' ? '▶' : '▤'}</span>;
}

export default function DashboardPage(): ReactElement {
  const pathname = usePathname();
  const preview = pathname === '/dashboard-preview';
  const [contents, setContents] = useState<ContentSummary[] | null>(null);
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [weakLoaded, setWeakLoaded] = useState(false);
  const [mastery, setMastery] = useState<MasteryItem[] | null>(null);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [statsErrors, setStatsErrors] = useState({ weak: '', mastery: '', notes: '' });
  const [statsRevision, setStatsRevision] = useState({ weak: 0, mastery: 0, notes: 0 });
  const retryStat = (key: keyof typeof statsRevision): void => { setStatsRevision((value) => ({ ...value, [key]: value[key] + 1 })); };
  const [flashcardCount, setFlashcardCount] = useState<number | null>(null);
  const [contentError, setContentError] = useState('');
  const [dueError, setDueError] = useState('');
  const [contentRevision, setContentRevision] = useState(0);
  const [dueRevision, setDueRevision] = useState(0);

  useEffect(() => {
    if (preview) {
      setContents([
        { contentId: 'preview-1', contentType: 'video', title: '深度学习视觉理解：从图像到知识', description: null, durationSec: 2460, pageCount: null, status: '已就绪', coverUrl: null, understandingStatus: 'completed', createdAt: '2026-09-16T09:00:00.000Z', updatedAt: '2026-09-16T09:30:00.000Z' },
        { contentId: 'preview-2', contentType: 'document', title: '教育心理学 · 认知负荷理论讲义', description: null, durationSec: null, pageCount: 28, status: '已就绪', coverUrl: null, understandingStatus: 'completed', createdAt: '2026-09-15T12:00:00.000Z', updatedAt: '2026-09-15T12:30:00.000Z' },
        { contentId: 'preview-3', contentType: 'video', title: '高效复习系统：如何建立长期记忆', description: null, durationSec: 1320, pageCount: null, status: '解析中', coverUrl: null, understandingStatus: 'running', createdAt: '2026-09-14T16:00:00.000Z', updatedAt: '2026-09-14T16:10:00.000Z' },
      ]);
      setWeakPoints([
        { pointId: 'weak-1', title: '认知负荷与工作记忆', tags: ['教育心理学'], score: 0.38, contentId: 'preview-2', contentTitle: '教育心理学 · 认知负荷理论讲义', relatedFlashcardCount: 6, lastReviewAt: '2026-09-15T12:00:00.000Z' },
        { pointId: 'weak-2', title: '卷积神经网络的特征提取', tags: ['深度学习'], score: 0.54, contentId: 'preview-1', contentTitle: '深度学习视觉理解：从图像到知识', relatedFlashcardCount: 4, lastReviewAt: '2026-09-16T09:00:00.000Z' },
        { pointId: 'weak-3', title: '间隔重复的复习窗口', tags: ['学习方法'], score: 0.67, contentId: 'preview-3', contentTitle: '高效复习系统：如何建立长期记忆', relatedFlashcardCount: 3, lastReviewAt: null },
      ]);
      setMastery([
        { pointId: 'weak-1', title: '认知负荷与工作记忆', score: 0.38, isWeak: true, reviewCount: 2, correctRate: 0.4 },
        { pointId: 'weak-2', title: '卷积神经网络的特征提取', score: 0.54, isWeak: true, reviewCount: 3, correctRate: 0.6 },
        { pointId: 'weak-3', title: '间隔重复的复习窗口', score: 0.67, isWeak: false, reviewCount: 4, correctRate: 0.75 },
      ]);
      setNotesCount(12);
      setFlashcardCount(18);
      setWeakLoaded(true);
      return;
    }

  }, [preview]);

  useEffect(() => {
    if (preview) return;
    let active = true; setContents(null); setContentError('');
    void api.contents().then((result): void => {
      if (!active) return;
      setContents(result.items);
    }).catch(() => { if (active) setContentError('学习资料暂时无法读取，请重试。'); });
    return () => { active = false; };
  }, [preview, contentRevision]);

  useEffect(() => {
    if (preview) return;
    let active = true; setFlashcardCount(null); setDueError('');
    void api.flashcards(true).then((result) => { if (active) setFlashcardCount(result.total); }).catch(() => { if (active) setDueError('到期自测项暂时无法读取，请重试。'); });
    return () => { active = false; };
  }, [preview, dueRevision]);

  useEffect(() => {
    if (preview) return;
    let active = true; setWeakLoaded(false); setStatsErrors((value) => ({ ...value, weak: '' }));
    void api.weakPoints().then((result) => { if (active) { setWeakPoints(result.items); setWeakLoaded(true); } }).catch(() => { if (active) setStatsErrors((value) => ({ ...value, weak: '薄弱点读取失败' })); });
    return () => { active = false; };
  }, [preview, statsRevision.weak]);
  useEffect(() => {
    if (preview) return;
    let active = true; setMastery(null); setStatsErrors((value) => ({ ...value, mastery: '' }));
    void api.mastery().then((result) => { if (active) setMastery(result.items); }).catch(() => { if (active) setStatsErrors((value) => ({ ...value, mastery: '掌握度读取失败' })); });
    return () => { active = false; };
  }, [preview, statsRevision.mastery]);
  useEffect(() => {
    if (preview) return;
    let active = true; setNotesCount(null); setStatsErrors((value) => ({ ...value, notes: '' }));
    if (!contents) return () => { active = false; };
    void Promise.all(contents.map((item) => api.notes(item.contentId))).then((results) => { if (active) setNotesCount(results.reduce((total, item) => total + item.items.length, 0)); }).catch(() => { if (active) setStatsErrors((value) => ({ ...value, notes: '笔记统计读取不完整，请重试' })); });
    return () => { active = false; };
  }, [preview, contents, statsRevision.notes]);

  const readyCount = contents?.filter((item) => item.status === '已就绪').length ?? 0;
  const masteryRate = mastery && mastery.length > 0 ? `${Math.round((mastery.reduce((total, item) => total + item.score, 0) / mastery.length) * 100)}%` : '—';
  const masteryHint = statsErrors.mastery || (mastery === null ? '正在读取掌握度' : mastery.length === 0 ? '暂无掌握度记录' : '持续复习，保持节奏');

  return (
    <AppShell preview={preview} title="我的学习" subtitle={preview ? '正在浏览免登录示例，你可以先看看文豪怎么陪你学习。' : '把输入过的每一分钟，沉淀成可以复习的知识资产。'}>
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="hero-label">TODAY · LEARNING DESK</span>
          <h1 className="hero-title">把今天的学习，<em>推进一小步。</em></h1>
          <p className="hero-copy">
            {(flashcardCount ?? 0) > 0 || (weakLoaded && weakPoints.length > 0)
              ? [flashcardCount !== null && flashcardCount > 0 ? `你有 ${flashcardCount} 项自测等待复习` : '', weakLoaded && weakPoints.length > 0 ? `${weakPoints.length} 个薄弱点值得优先补强` : ''].filter(Boolean).join('，') + '。'
              : '从下面选择一项任务，继续学习或巩固学过的知识。'}
          </p>
          <Link href={preview ? '/register' : contents?.length === 0 && !contentError ? '/import' : '#today-tasks-title'} className="hero-action">{preview ? '注册后开始复习' : contents?.length === 0 && !contentError ? '导入第一份资料' : '选择下一步'} <span>→</span></Link>
        </div>
        <div className="hero-side-stat">
          <span>综合掌握度</span>
          <strong>{masteryRate}</strong>
          <small>{masteryHint}</small>
        </div>
      </section>

      {!preview && contents !== null && !contentError && <LearningGuide initiallyOpen={contents.length === 0} />}
      <div className="mt-6"><TodayLearningTasks contents={contents} contentError={contentError} onRetryContents={() => setContentRevision((value) => value + 1)} dueCount={flashcardCount} dueError={dueError} onRetryDue={() => setDueRevision((value) => value + 1)} preview={preview} /></div>
      {!preview && <><PlanReminders /><DailyCheckInCard compact /></>}

      <section className="dashboard-stat-grid" aria-label="学习概览">
        <StatCard label="内容资产" value={contents?.length ?? '—'} hint={contents ? `${readyCount} 个内容已就绪` : contentError ? '资料读取失败' : '正在读取资料'} color="#9f8cff" />
        <StatCard label="笔记" value={notesCount ?? '—'} hint={statsErrors.notes || (notesCount !== null ? '跨内容实时笔记总数' : contentError ? '需先重新读取资料' : '正在读取笔记统计')} onRetry={statsErrors.notes ? () => retryStat('notes') : undefined} color="#68e2c7" />
        <StatCard label="待复习自测项" value={flashcardCount ?? '—'} hint={dueError ? '到期自测项读取失败' : flashcardCount === null ? '正在读取到期自测项' : '当前到期项总数'} color="#f6c76d" />
        <StatCard label="知识点掌握" value={masteryRate} hint={masteryHint} onRetry={statsErrors.mastery ? () => retryStat('mastery') : undefined} color="#ff8ca8" />
      </section>

      <div className="dashboard-section-grid">
        <section id="content-list" className="dashboard-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">CONTINUE LEARNING</span>
              <h2 className="section-title">我的学习资料</h2>
              <p className="section-description">最近导入的最多六份资料；按上次学习位置继续，请使用上方续学入口。</p>
            </div>
            <Link href={preview ? '/register' : '/import'} className="section-link">{preview ? '注册后导入' : '导入内容'} <span>↗</span></Link>
          </div>

          {contentError ? <p role="alert" className="text-rose">{contentError}</p> : !contents ? <p role="status">正在加载资料…</p> : contents.length === 0 ? (
            <div className="dashboard-empty"><span>✦</span><p>还没有内容，先导入一段视频或一份文档吧。</p><Link href="/import">创建第一份内容</Link></div>
          ) : (
            <div className="content-list">
              {contents.slice(0, 6).map((content) => (
                <div key={content.contentId} className="content-row">
                  <ContentIcon type={content.contentType} />
                  <div className="content-meta">
                    <div className="content-meta-line"><span>{content.contentType === 'video' ? '视频' : '图文'}</span><i>·</i><span className={content.status === '已就绪' ? 'status-ready' : 'status-pending'}>{content.status}</span></div>
                    <h3>{content.title}</h3>
                  </div>
                  {content.status === '已就绪' ? <Link href={preview ? '/register' : `/study/${content.contentId}`} className="content-open">{preview ? '注册后继续' : '继续学习'} <span>→</span></Link> : <span className="content-pending">{content.status === "失败" ? "解析失败" : content.status === "待导入" ? "待上传" : content.status}</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">FOCUS AREAS</span>
              <h2 className="section-title">薄弱点</h2>
              <p className="section-description">从掌握度最低的知识点开始。</p>
            </div>
            <Link href={preview ? '/register' : '/graph'} className="section-link">{preview ? '注册后查看' : '查看知识图谱'} <span>↗</span></Link>
          </div>

          {statsErrors.weak ? <div role="alert"><p>{statsErrors.weak}</p><button type="button" className="min-h-11 text-brand-ink" onClick={() => retryStat('weak')}>重试薄弱点</button></div> : !weakLoaded ? <p role="status">正在读取薄弱点…</p> : weakPoints.length === 0 ? (
            <div className="dashboard-empty"><span>◎</span><p>完成几次复习后，这里会出现个性化薄弱点。</p><Link href="/review">去完成复习</Link></div>
          ) : (
            <div className="weak-list">
              {weakPoints.slice(0, 5).map((point) => (
                  <Link key={point.pointId} href={preview ? '/register' : `/review?contentId=${encodeURIComponent(point.contentId)}`} className="weak-row">
                  <div className="weak-row-head"><span>{point.title}</span><strong>{Math.round(point.score * 100)}%</strong></div>
                  <div className="weak-track"><span style={{ width: `${Math.max(0, point.score * 100)}%` }} /></div>
                  <p>{point.contentTitle} · {point.relatedFlashcardCount} 项关联自测</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="learning-loop" aria-label="学习闭环">
        <div><span className="section-kicker">THE LEARNING LOOP</span><h2>让知识真正留下来</h2></div>
        <div className="loop-steps"><span><b>01</b> 导入内容</span><i>→</i><span><b>02</b> 理解重点</span><i>→</i><span><b>03</b> 间隔复习</span></div>
      </section>
    </AppShell>
  );
}
