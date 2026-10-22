'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { AppShell } from '@/components/app/AppShell';
import { graphNodeType, graphStatus, hasGraphLearningRecord } from '@/lib/domain/graph-presentation';
import { api, type ContentGraph, type ContentSummary, type GraphNode, type GraphOverview, type GraphOverviewNode, type MasteryItem, type WeakPoint } from '@/services/api';

type GraphTab = 'graph' | 'weak-points';
type GraphData = GraphOverview | ContentGraph;

function MasteryPortrait({ items, loading, error, onRetry }: { items: MasteryItem[]; loading: boolean; error: string; onRetry: () => void }): ReactElement {
  const average = items.length === 0 ? 0 : items.reduce((total, item) => total + item.score, 0) / items.length;
  const circumference = 2 * Math.PI * 52;
  return <section className="rounded-lg border border-glass-line bg-surface p-5 text-center">
    <h2 className="text-sm font-medium text-textSub">全内容掌握度画像</h2>
    {loading ? <p role="status" className="mt-5 text-sm text-textSub">正在加载掌握度…</p> : error ? <div role="alert" className="mt-5 text-sm text-rose"><p>{error}</p><button type="button" onClick={onRetry} className="mt-3 rounded-md border border-brand px-3 py-3 text-brand-ink">重试掌握度</button></div> : items.length === 0 ? <p className="mt-5 text-sm text-textSub">暂无掌握度记录，完成复习或练习后会更新。</p> : <>
      <div className="relative mx-auto mt-5 grid h-36 w-36 place-items-center"><svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90" aria-hidden="true"><circle cx="72" cy="72" r="52" fill="none" stroke="#eee7dc" strokeWidth="10" /><circle cx="72" cy="72" r="52" fill="none" stroke="#4d7cfe" strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - average)} /></svg><strong className="absolute text-2xl">{percentage(average)}</strong></div>
      <h3 className="mt-3 font-semibold">综合掌握度</h3><p className="mt-2 text-sm text-textSub">已记录 {items.length} 个知识点</p>
      <div className="mt-5 grid grid-cols-3 gap-2 text-xs">{([{ label: '已掌握', count: items.filter((item) => item.score >= 0.8).length }, { label: '熟练', count: items.filter((item) => item.score >= 0.6 && item.score < 0.8).length }, { label: '待补强', count: items.filter((item) => item.score < 0.6).length }]).map((tier) => <div key={tier.label} className="rounded-md bg-brand-soft p-2 text-brand-ink"><strong className="block text-base">{tier.count}</strong>{tier.label}</div>)}</div>
    </>}
  </section>;
}

function percentage(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function tagLabel(tags: string[]): string {
  return tags[0] ?? '未分类';
}

function nodeContentIds(node: GraphNode | undefined, selectedContentId: string): string[] {
  if (!node) return [];
  const maybeContentIds = (node as GraphOverviewNode).contentIds;
  return Array.isArray(maybeContentIds) ? maybeContentIds : selectedContentId ? [selectedContentId] : [];
}

export default function GraphPage(): ReactElement {
  const [items, setItems] = useState<WeakPoint[]>([]);
  const [mastery, setMastery] = useState<MasteryItem[]>([]);
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [selectedContentId, setSelectedContentId] = useState('');
  const [selectedGraphContentId, setSelectedGraphContentId] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedPointId, setSelectedPointId] = useState('');
  const [tab, setTab] = useState<GraphTab>('graph');
  const [error, setError] = useState('');
  const [masteryError, setMasteryError] = useState('');
  const [contentError, setContentError] = useState('');
  const [dataLoading, setDataLoading] = useState(true);
  const [dataRevision, setDataRevision] = useState(0);
  const [graphRevision, setGraphRevision] = useState(0);
  const [graphError, setGraphError] = useState('');
  const [graphLoading, setGraphLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setDataLoading(true);
    setError('');
    setMasteryError('');
    setContentError('');
    setItems([]);
    setMastery([]);
    void Promise.allSettled([api.weakPoints(), api.mastery(), api.contents()]).then((results) => {
      if (!active) return;
      const [weakResult, masteryResult, contentResult] = results;
      if (weakResult.status === 'fulfilled') setItems(weakResult.value.items);
      else setError(weakResult.reason instanceof Error ? weakResult.reason.message : '薄弱点暂不可用');
      if (masteryResult.status === 'fulfilled') setMastery(masteryResult.value.items);
      else setMasteryError(masteryResult.reason instanceof Error ? masteryResult.reason.message : '掌握度暂不可用');
      if (contentResult.status === 'fulfilled') setContents(contentResult.value.items);
      else setContentError(contentResult.reason instanceof Error ? contentResult.reason.message : '资料列表暂不可用');
      setDataLoading(false);
    });
    return () => { active = false; };
  }, [dataRevision]);

  useEffect(() => {
    let active = true;
    setGraphLoading(true);
    setGraphError('');
    setGraph(null);
    setSelectedPointId('');
    const request = selectedGraphContentId
      ? api.contentGraph(selectedGraphContentId)
      : api.graphOverview();
    void request.then((result) => {
      if (active) setGraph(result);
    }).catch((reason: unknown) => {
      if (!active) return;
      setGraphError(reason instanceof Error ? reason.message : '图谱暂时无法加载');
      setGraph(null);
    }).finally(() => {
      if (active) setGraphLoading(false);
    });
    return () => { active = false; };
  }, [selectedGraphContentId, graphRevision]);

  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.contentId, content.title])), [contents]);
  const weakContents = useMemo(() => Array.from(new Map(items.map((item) => [item.contentId, item.contentTitle])).entries()), [items]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags))).sort((left, right) => left.localeCompare(right, 'zh-CN')), [items]);
  const filteredItems = useMemo(() => items.filter((item) => (!selectedContentId || item.contentId === selectedContentId) && (!selectedTag || item.tags.includes(selectedTag))), [items, selectedContentId, selectedTag]);
  const reviewHref = filteredItems[0] ? `/review?contentId=${encodeURIComponent(filteredItems[0].contentId)}` : '/review';
  const graphNodes = graph?.nodes ?? [];
  const selectedNode = graphNodes.find((node) => node.pointId === selectedPointId);
  const selectedContentIds = nodeContentIds(selectedNode, selectedGraphContentId);
  const selectedPointIds = (selectedNode as GraphOverviewNode | undefined)?.pointIds;
  const selectedPointCount = Array.isArray(selectedPointIds) ? selectedPointIds.length : 1;
  const orderedNodes = [...graphNodes].sort((left, right) => Number(hasGraphLearningRecord(right) && right.isWeak) - Number(hasGraphLearningRecord(left) && left.isWeak) || left.title.localeCompare(right.title, 'zh-CN'));

  return <AppShell title="知识图谱" subtitle="查看已解析知识点、学习记录与原文来源。">
    <div className="space-y-6">
      <header className="graph-page-header"><h1 className="text-2xl font-bold">知识图谱</h1><p className="mt-3 text-sm leading-6 text-textSub">选择资料和知识点，回看原文，找到需要巩固的内容。</p></header>
      <section className="graph-toolbar rounded-lg border border-glass-line bg-surface p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex gap-2" role="tablist" aria-label="知识图谱视图">
              <button type="button" role="tab" aria-selected={tab === 'graph'} onClick={() => setTab('graph')} className={`graph-tab ${tab === 'graph' ? 'is-active' : ''}`}>全部知识点</button>
              <button type="button" role="tab" aria-selected={tab === 'weak-points'} onClick={() => setTab('weak-points')} className={`graph-tab ${tab === 'weak-points' ? 'is-active' : ''}`}>需要巩固</button>
            </div>
            <p className="mt-3 text-sm text-textSub">{tab === 'graph' ? '清单来自已有解析；没有学习记录时不推测掌握情况。' : '按资料和标签筛选有实际学习记录的薄弱点。'}</p>
          </div>
          {tab === 'graph' ? <label className="text-xs text-textMute">资料范围
            <select disabled={dataLoading || !!contentError} value={selectedGraphContentId} onChange={(event) => setSelectedGraphContentId(event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 max-w-sm rounded-xl border border-glass-line bg-bg px-3 py-2 text-sm text-text">
              <option value="">全部学习内容</option>
              {contents.map((content) => <option key={content.contentId} value={content.contentId}>{content.title}</option>)}
            </select>
          </label> : <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-textMute">内容
              <select value={selectedContentId} onChange={(event) => setSelectedContentId(event.target.value)} className="mt-1 block w-full rounded-md border border-glass-line bg-bg px-3 py-2 text-sm text-text"><option value="">全部内容</option>{weakContents.map(([contentId, title]) => <option key={contentId} value={contentId}>{title}</option>)}</select>
            </label>
            <label className="text-xs text-textMute">学科 / 标签
              <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} className="mt-1 block w-full rounded-md border border-glass-line bg-bg px-3 py-2 text-sm text-text"><option value="">全部学科</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select>
            </label>
          </div>}
        </div>
      </section>

      {error || contentError ? <div role="alert" className="rounded-md bg-rose-soft px-4 py-3 text-sm text-rose"><p>{[error, contentError].filter(Boolean).join('；')}</p><button type="button" disabled={dataLoading} onClick={() => setDataRevision((value) => value + 1)} className="mt-2 rounded-md border border-brand px-3 py-3 text-brand-ink">重新加载看板数据</button></div> : null}
      {tab === 'graph' ? <>
        {graphError ? <div role="alert" className="rounded-md bg-rose-soft px-4 py-3 text-sm text-rose"><p>{graphError}</p><button type="button" onClick={() => setGraphRevision((value) => value + 1)} className="mt-2 rounded-md border border-brand px-3 py-3 text-brand-ink">重新加载知识图谱</button></div> : null}
        {graphLoading ? <div className="graph-canvas-empty" role="status">正在读取知识图谱…</div> : graphError ? null : <div className="grid gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 rounded-lg border border-glass-line bg-surface p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-semibold">{selectedGraphContentId ? contentTitleById.get(selectedGraphContentId) ?? '所选资料知识点' : '全部资料知识点'}</h2><p className="mt-1 text-xs text-textSub">{graphNodes.length} 个知识点</p></div>
              <div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-textSub"><span>较熟悉 ≥80%</span><span>待巩固 60–80%</span><span>待补强 &lt;60%</span><span>暂无学习记录</span></div>
            </div>
            {orderedNodes.length > 0 ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{orderedNodes.map((node) => <button key={node.pointId} type="button" aria-pressed={selectedPointId === node.pointId} onClick={() => setSelectedPointId(node.pointId)} className={`min-h-11 min-w-0 break-words rounded-lg border p-3 text-left text-sm ${selectedPointId === node.pointId ? 'border-brand bg-brand-soft' : 'border-glass-line'}`}><strong className="block">{node.title}</strong><span className="mt-1 block text-xs text-textSub">{graphStatus(node)}</span></button>)}</div> : <p className="py-8 text-sm text-textSub">当前资料暂无已解析知识点，可先阅读原资料或查看解析状态。</p>}
          </section>
          <aside className="space-y-5">
            {selectedNode ? <section className="rounded-lg border border-glass-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-xs text-textMute">{graphNodeType(selectedNode.nodeType)} · {graphStatus(selectedNode)}</span><h2 className="mt-1 break-words text-lg font-semibold">{selectedNode.title}</h2></div><button type="button" aria-label="关闭知识点详情" onClick={() => setSelectedPointId('')} className="min-h-11 min-w-11 rounded-full text-textMute hover:bg-bg">×</button></div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-md bg-brand-soft p-3"><strong className="block text-base text-brand-ink">{hasGraphLearningRecord(selectedNode) ? percentage(selectedNode.mastery) : '暂无记录'}</strong>掌握度</div><div className="rounded-md bg-rose-soft p-3"><strong className="block text-base text-rose">{hasGraphLearningRecord(selectedNode) ? Number((selectedNode as GraphOverviewNode).weakPointCount ?? selectedNode.isWeak) : '—'}</strong>薄弱知识点</div></div>
              <dl className="mt-4 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-textMute">复习次数</dt><dd className="font-medium">{selectedNode.reviewCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-textMute">练习正确率</dt><dd className="font-medium">{selectedNode.correctRate === null ? '暂无记录' : percentage(selectedNode.correctRate)}</dd></div><div className="flex justify-between gap-3"><dt className="text-textMute">最近复习</dt><dd className="font-medium">{selectedNode.lastReviewedAt ? new Date(selectedNode.lastReviewedAt).toLocaleDateString('zh-CN') : '暂无记录'}</dd></div><div className="flex justify-between gap-3"><dt className="text-textMute">关联笔记 / 闪卡</dt><dd className="font-medium">{selectedNode.relatedNoteCount} 条 / {selectedNode.relatedFlashcardCount} 张</dd></div></dl>
              {Array.isArray((selectedNode as GraphOverviewNode).aliases) && (selectedNode as GraphOverviewNode).aliases.length > 0 ? <p className="mt-4 text-xs text-textSub">其他名称：{(selectedNode as GraphOverviewNode).aliases.join('、')}</p> : null}
              {selectedPointCount > 1 && <p className="mt-3 text-xs leading-6 text-textSub">这是跨资料合并知识点，分数沿用所有合并项的汇总（未记录项计入原汇总）。可按资料查看题库；选择单份资料后可精确练习该知识点。</p>}
              <div className="mt-4 space-y-3">{selectedContentIds.map((contentId) => {
                const exactPoint = selectedGraphContentId || (selectedContentIds.length === 1 && selectedPointCount === 1);
                const practiceHref = `/question-bank?contentId=${encodeURIComponent(contentId)}` + (exactPoint ? `&pointId=${encodeURIComponent(selectedNode.pointId)}` : '');
                return <div key={contentId} className="rounded-xl border border-glass-line p-3"><Link href={`/study/${encodeURIComponent(contentId)}`} className="inline-flex min-h-11 items-center text-xs text-brand-ink hover:underline">打开「{contentTitleById.get(contentId) ?? '来源内容'}」查看笔记与闪卡 ↗</Link><div className="flex flex-wrap gap-2"><Link href={practiceHref} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-3 text-xs text-bg">{exactPoint ? '练习这个知识点' : '查看该资料题库'}</Link><Link href={`/review?contentId=${encodeURIComponent(contentId)}`} className="inline-flex min-h-11 items-center rounded-lg border border-glass-line px-3 text-xs text-brand-ink">复习该资料到期项</Link></div></div>;
              })}</div>
              <p className="mt-3 text-xs leading-6 text-textSub">进入练习不自动作答或出题；没有已有题目时会显示空态。</p>
            </section> : <section className="rounded-lg border border-glass-line bg-surface p-5"><h2 className="font-semibold">知识点详情</h2><p className="mt-2 text-sm text-textSub">从清单选择知识点，查看学习记录和原文来源。</p></section>}
            <details><summary className="min-h-11 cursor-pointer py-3 text-sm">查看学习记录统计</summary><MasteryPortrait items={mastery} loading={dataLoading} error={masteryError} onRetry={() => setDataRevision((value) => value + 1)} /></details>
          </aside>
        </div>}
      </> : <div className="grid gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-lg border border-glass-line bg-surface p-5"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">薄弱点清单</h2>{!dataLoading && !error ? <p className="mt-1 text-sm text-textSub">当前筛选下 {filteredItems.length} 个知识点需要补强。</p> : null}</div>{!dataLoading && !error && filteredItems.length > 0 ? <Link href={reviewHref} className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white">一键进入薄弱点复习</Link> : null}</div>{dataLoading ? <p role="status" className="mt-6 text-sm text-textSub">正在加载薄弱点…</p> : error ? <p className="mt-6 text-sm text-textSub">薄弱点加载失败，请重试后查看。</p> : filteredItems.length === 0 ? <div className="mt-6 rounded-md border border-dashed border-glass-line p-10 text-center text-sm text-textSub">当前筛选下暂无薄弱点。完成闪卡或练习后，这里会同步更新。</div> : <div className="mt-5 divide-y divide-glass-line">{filteredItems.map((item) => <article key={item.pointId} className="py-4 first:pt-0"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-rose-soft px-2 py-1 text-xs text-rose">{tagLabel(item.tags)}</span><h3 className="font-medium">{item.title}</h3></div><p className="mt-2 text-xs text-textSub">{item.contentTitle} · {item.relatedFlashcardCount} 张关联闪卡{item.lastReviewAt ? ` · 最近复习 ${new Date(item.lastReviewAt).toLocaleDateString('zh-CN')}` : ''}</p></div><div className="flex flex-wrap items-center gap-3"><div className="w-24"><span className="text-sm font-semibold text-rose">{percentage(item.score)}</span><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-rose" style={{ width: `${Math.max(0, item.score * 100)}%` }} /></div></div><Link href={`/review?contentId=${encodeURIComponent(item.contentId)}`} className="inline-flex min-h-11 items-center rounded-md border border-brand px-3 py-2 text-sm text-brand-ink hover:bg-brand-soft">复习</Link><Link href={`/question-bank?contentId=${encodeURIComponent(item.contentId)}&pointId=${encodeURIComponent(item.pointId)}`} className="inline-flex min-h-11 items-center rounded-md border border-glass-line px-3 py-2 text-sm text-brand-ink">练习</Link></div></div></article>)}</div>}</section>
        <aside><MasteryPortrait items={mastery} loading={dataLoading} error={masteryError} onRetry={() => setDataRevision((value) => value + 1)} /></aside>
      </div>}
    </div>
  </AppShell>;
}
