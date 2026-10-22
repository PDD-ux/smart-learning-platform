'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AppShell } from '@/components/app/AppShell';
import { studyCitationUrl } from '@/lib/domain/study-location';
import { api, type ContentSummary, type PersonalNote, type PersonalNoteList, type NoteExportResult } from '@/services/api';

function location(note: PersonalNote): string {
  if (note.ref.type === 'document') return `第 ${note.ref.page} 页`;
  const seconds = note.ref.timestampSec;
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export default function NotesPage(): ReactElement {
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [contentsError, setContentsError] = useState('');
  const [contentsLoading, setContentsLoading] = useState(true);
  const [contentsRevision, setContentsRevision] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState({ q: '', contentId: '', page: 1 });
  const [result, setResult] = useState<PersonalNoteList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<PersonalNote | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<PersonalNote | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const [format, setFormat] = useState<'markdown' | 'txt'>('markdown');
  const [download, setDownload] = useState<NoteExportResult | null>(null);
  const blocked = busy || editing !== null || deleting !== null;

  useEffect(() => { mounted.current = true; return (): void => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setContentsLoading(true); setContentsError('');
    void api.contents().then((value): void => { if (active) setContents(value.items); }).catch((): void => { if (active) setContentsError('资料筛选读取失败'); }).finally((): void => { if (active) setContentsLoading(false); });
    return (): void => { active = false; };
  }, [contentsRevision]);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setResult(null);
    void api.personalNotes({ ...filter, pageSize: 20 }).then((value): void => {
      if (!active) return;
      const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
      if (value.page > lastPage) { setFilter((previous) => ({ ...previous, page: lastPage })); return; }
      setResult(value);
    }).catch((): void => { if (active) setError('笔记读取失败，请重试。尚未确认当前笔记数量。'); }).finally((): void => { if (active) setLoading(false); });
    return (): void => { active = false; };
  }, [filter, revision]);

  function changeFilter(next: typeof filter): void {
    if (lock.current || editing || deleting) return;
    setResult(null); setLoading(true); setDownload(null); setNotice(''); setWriteError(''); setFilter(next);
  }
  async function mutate(kind: 'save' | 'delete' | 'export'): Promise<void> {
    if (lock.current) return;
    if (kind === 'save' && (!editing || !draft.trim())) { setWriteError('笔记不能为空'); return; }
    if (kind === 'delete' && !deleting) return;
    if (kind === 'export' && (!filter.contentId || !contents.some((item): boolean => item.contentId === filter.contentId))) return;
    lock.current = true; setBusy(true); setWriteError(''); setNotice(''); setDownload(null);
    try {
      if (kind === 'save' && editing) {
        const saved = await api.updateNote(editing.noteId, { content: draft, expectedVersion: editing.version });
        if (!mounted.current) return;
        setEditing(null); setDraft(''); setNotice(saved.isOverwritten ? '已保存。此笔记在编辑期间曾被修改，本次内容按原规则覆盖了旧版本，请核对。' : '笔记已保存');
      } else if (kind === 'delete' && deleting) {
        await api.deleteNote(deleting.noteId);
        if (!mounted.current) return;
        setDeleting(null); setNotice('笔记已删除');
      } else {
        const exported = await api.exportNotes(filter.contentId, format);
        if (!mounted.current) return;
        setDownload(exported); setNotice('导出文件已准备好，请点击下载。包含所选资料的全部个人笔记。'); return;
      }
      setResult(null); setLoading(true); setRevision((value): number => value + 1);
    } catch (cause: unknown) {
      if (mounted.current) setWriteError(cause instanceof Error ? cause.message : '操作失败，请手动重试');
    } finally {
      lock.current = false; if (mounted.current) setBusy(false);
    }
  }
  const selected = contents.find((item): boolean => item.contentId === filter.contentId);
  return <AppShell title="我的笔记"><div className="personal-notes">
    <header><h1>我的笔记</h1><p>查找你已保存的个人笔记，回到原文继续学习。预解析重点和未保存的随看草稿不在此列表中。</p><Link href="/import" className="learner-text-action">去学习中心记笔记 →</Link></header>
    <section className="personal-notes-tools" aria-label="笔记筛选与导出">
      <form onSubmit={(event): void => { event.preventDefault(); changeFilter({ ...filter, q: q.trim(), page: 1 }); }}>
        <label>笔记关键词<input maxLength={200} value={q} disabled={blocked} onChange={(event): void => setQ(event.target.value)} placeholder="搜索个人笔记正文" /></label>
        <button disabled={blocked} type="submit">搜索笔记</button>
        <label>资料<select value={filter.contentId} disabled={blocked || contentsLoading || Boolean(contentsError)} onChange={(event): void => changeFilter({ ...filter, contentId: event.target.value, page: 1 })}><option value="">全部资料</option>{contents.map((item): ReactElement => <option key={item.contentId} value={item.contentId}>{item.title}</option>)}</select></label>
        <button type="button" disabled={blocked} onClick={(): void => { setQ(''); changeFilter({ q: '', contentId: '', page: 1 }); }}>清除筛选</button>
      </form>
      {contentsLoading ? <p role="status">正在读取资料筛选…</p> : contentsError ? <p role="alert">{contentsError} <button disabled={blocked} onClick={(): void => setContentsRevision((value): number => value + 1)}>重试资料筛选</button></p> : null}
      <div className="personal-notes-export"><label>导出格式<select value={format} disabled={blocked} onChange={(event): void => { setFormat(event.target.value === 'txt' ? 'txt' : 'markdown'); setDownload(null); }}><option value="markdown">Markdown</option><option value="txt">TXT</option></select></label><button disabled={blocked || !selected || contentsLoading || Boolean(contentsError)} onClick={(): void => { void mutate('export'); }}>导出所选资料全部个人笔记</button></div>
      <p>{selected ? `导出范围：${selected.title}的全部个人笔记，不受关键词或当前分页限制。` : '先选择一份资料，再导出该资料的全部个人笔记。'}</p>
      {download ? <a className="learner-text-action" href={download.downloadUrl} download={download.fileName}>下载笔记文件（链接约 {Math.floor(download.expiresInSec / 60)} 分钟内有效）</a> : null}
    </section>
    {notice ? <p role="status" className="personal-notes-notice">{notice}</p> : null}
    {writeError ? <p role="alert">{writeError}</p> : null}
    <section aria-label="个人笔记列表" aria-busy={loading}>
      {loading ? <p role="status">正在读取笔记…</p> : error ? <div role="alert"><p>{error}</p><button disabled={blocked} onClick={(): void => setRevision((value): number => value + 1)}>重试笔记列表</button></div> : result ? <>
        <h2>已保存笔记 · {result.total} 条</h2><p>按最近修改排序{filter.q ? ` · 正文关键词：${filter.q}` : ''}</p>
        {result.items.length === 0 ? <p>当前范围暂无已保存笔记。可以清除筛选，或到学习中心打开资料并保存个人笔记。</p> : <div className="personal-notes-list">{result.items.map((note): ReactElement => <article key={note.noteId}>
          <h3>{note.contentTitle}</h3><p>{location(note)} · 修改于 {new Date(note.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>
          {editing?.noteId === note.noteId ? <><label>编辑笔记<textarea maxLength={5000} value={draft} disabled={busy} onChange={(event): void => setDraft(event.target.value)} /></label><div className="personal-notes-actions"><button disabled={busy} onClick={(): void => { void mutate('save'); }}>保存笔记</button><button disabled={busy} onClick={(): void => { setEditing(null); setDraft(''); setWriteError(''); }}>取消编辑</button></div></> : <><p className="personal-note-body">{note.content}</p><div className="personal-notes-actions"><Link className="learner-text-action" href={studyCitationUrl(note.contentId, note.ref)}>回看来源 · {location(note)}</Link><button disabled={blocked || loading} onClick={(): void => { setEditing(note); setDraft(note.content); setWriteError(''); setNotice(''); }}>编辑笔记</button><button disabled={blocked || loading} onClick={(): void => { setDeleting(note); setWriteError(''); setNotice(''); }}>删除笔记</button></div></>}
          {deleting?.noteId === note.noteId ? <div role="alertdialog" aria-label="确认删除笔记"><p>确认删除这条个人笔记？删除后无法恢复，原资料不受影响。</p><button disabled={busy} onClick={(): void => { void mutate('delete'); }}>确认删除</button><button disabled={busy} onClick={(): void => { setDeleting(null); setWriteError(''); }}>取消删除</button></div> : null}
        </article>)}</div>}
        <nav aria-label="笔记分页"><button disabled={blocked || result.page <= 1} onClick={(): void => changeFilter({ ...filter, page: filter.page - 1 })}>上一页</button><span>第 {result.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页</span><button disabled={blocked || result.page * result.pageSize >= result.total} onClick={(): void => changeFilter({ ...filter, page: filter.page + 1 })}>下一页</button></nav>
      </> : null}
    </section>
  </div></AppShell>;
}
