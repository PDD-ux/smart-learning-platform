'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { AppShell } from '@/components/app/AppShell';
import { AdminShell } from '@/components/admin/AdminShell';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { classrooms } from '@/services/classrooms';
import type { ClassCommand, ClassDetail, ClassList, ClassResult, ClassSources } from '@/lib/classrooms/contracts';
import styles from './ClassroomWorkspace.module.css';
const labels: Record<string, string> = { ACTIVE: '进行中', ARCHIVED: '已归档', DRAFT: '草稿', PUBLISHED: '已发布', CLOSED: '已关闭', WITHDRAWN: '已撤回', LEFT: '已退出', REMOVED: '已移除' };
function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : '操作暂未完成，请保留输入并重试'; }
function date(value: string): string { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function localDate(value: string | null): string { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function text(form: FormData, key: string): string { return String(form.get(key) ?? ''); }
type WorkspacePortal = 'student' | 'teacher' | 'admin';
function Shell({ portal, children }: { portal: WorkspacePortal; children: ReactNode }): ReactElement { return portal === 'teacher' ? <TeacherShell>{children}</TeacherShell> : portal === 'admin' ? <AdminShell>{children}</AdminShell> : <AppShell title="班级课程" compactNavigation>{children}</AppShell>; }
function managerBase(portal: WorkspacePortal): string { return portal === 'teacher' ? '/teacher/classes' : portal === 'admin' ? '/admin/classes' : '/classes'; }
function useUnsaved(dirty: boolean): void {
  useEffect((): (() => void) => {
    if (!dirty) return (): void => undefined;
    const unload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent): void => { const link = event.target instanceof Element ? event.target.closest('a[href]') : null; if (link instanceof HTMLAnchorElement && link.target !== '_blank' && link.href !== location.href && !window.confirm('有未保存输入，确定离开并放弃吗？')) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return (): void => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty]);
}
function useWrite(): { busy: boolean; message: string; error: string; setError: (value: string) => void; run: (payload: unknown, work: (requestId: string) => Promise<ClassResult>, success: (result: ClassResult) => Promise<void>) => Promise<void> } {
  const lock = useRef(false), pending = useRef<{ payload: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const run = async (payload: unknown, work: (requestId: string) => Promise<ClassResult>, success: (result: ClassResult) => Promise<void>): Promise<void> => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage('');
    const serialized = JSON.stringify(payload); if (pending.current?.payload !== serialized) pending.current = { payload: serialized, id: crypto.randomUUID() };
    let saved = false;
    try { const result = await work(pending.current.id); saved = true; pending.current = null; setMessage(result.replayed ? '已核对先前保存结果。' : '已保存。'); await success(result); }
    catch (reason) { setError((saved ? '写入已完成，但重新读取失败；请刷新核对，不要重复创建。' : '') + errorText(reason)); }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, message, setError, run };
}
export function ClassroomList({ management = false, portal }: { management?: boolean; portal?: WorkspacePortal }): ReactElement {
  const workspacePortal = portal ?? (management ? 'admin' : 'student');
  const managementBase = managerBase(workspacePortal);
  const router = useRouter(), write = useWrite();
  const [data, setData] = useState<ClassList | null>(null), [page, setPage] = useState(1), [loading, setLoading] = useState(true), [error, setError] = useState(''), [dirty, setDirty] = useState(false), [retry, setRetry] = useState(0);
  useUnsaved(dirty);
  useEffect((): (() => void) => { let active = true; setLoading(true); setError(''); void classrooms.list(page).then((value): void => { if (active) setData(value); }).catch((reason: unknown): void => { if (active) setError(errorText(reason)); }).finally((): void => { if (active) setLoading(false); }); return (): void => { active = false; }; }, [page, retry]);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault(); const form = new FormData(event.currentTarget), create = data?.canCreate === true;
    const payload = create ? { title: text(form, 'title'), description: text(form, 'description') } : { code: text(form, 'code').trim(), confirmed: form.has('confirmed') };
    if (!create && !('confirmed' in payload && payload.confirmed)) { write.setError('请确认主动加入该班级'); return; }
    void write.run(payload, (requestId): Promise<ClassResult> => create ? classrooms.create({ requestId, title: text(form, 'title'), description: text(form, 'description') }) : classrooms.join({ requestId, code: text(form, 'code').trim(), confirmed: true }), async (result): Promise<void> => { setDirty(false); router.push(managementBase + '/' + result.classroomId); });
  };
  return <Shell portal={workspacePortal}><div className={styles.workspace}>
    <header><p className={styles.kicker}>{workspacePortal === 'teacher' ? 'TEACHING' : 'CLASSROOM'}</p><h1>{workspacePortal === 'teacher' ? '我的课程' : '班级课程'}</h1><p>{workspacePortal === 'teacher' ? '每门课程对应一个班级，学生使用邀请码加入；进入课程后管理章节、任务与正式提交。' : '负责人发布章节与学习任务，学生通过邀请码加入自己的班级。'}</p><Link href="/help">查看使用指南 →</Link>{data && !data.canCreate && workspacePortal === 'student' && <p><Link href="/classes/submissions">我的提交与反馈 →</Link></p>}</header>
    {(error || write.error) && <p role="alert" className={styles.error}>{error || write.error}</p>}{write.message && <p role="status">{write.message}</p>}
    <div className={styles.columns}><section className={styles.card}><div className={styles.row}><h2>{workspacePortal === 'teacher' ? '我负责的课程' : workspacePortal === 'admin' || data?.canCreate ? '我负责的班级' : '我加入的班级'}</h2><button disabled={loading || write.busy} onClick={(): void => setRetry((v): number => v + 1)}>刷新</button></div>
      {loading ? <p role="status">正在读取班级…</p> : !data ? <p>班级未能读取，请重试。</p> : <><div className={styles.stack}>{data.items.map((room): ReactElement => <article key={room.id} className={styles.item}><span className={styles.badge}>{labels[room.state]}</span><h3><Link href={managementBase + '/' + room.id}>{room.title}</Link></h3><p>{room.description || (workspacePortal === 'teacher' ? '暂无课程介绍' : '暂无班级介绍')}</p><Link href={managementBase + '/' + room.id}>{workspacePortal === 'teacher' ? '进入课程空间 →' : '进入班级 →'}</Link></article>)}</div>{!data.items.length && <p>{workspacePortal === 'admin' ? '当前管理员名下没有历史班级。' : workspacePortal === 'teacher' ? '还没有课程，创建后可发布章节和学习任务。' : data.canCreate ? '尚无班级，创建后可发布课程章节和作业。' : '尚未加入班级。向课程负责人索取邀请码后，可在学习中心的“班级课程”加入。'}</p>}<div className={styles.row}><button disabled={page <= 1 || write.busy} onClick={(): void => setPage(page - 1)}>上一页</button><span>第{page}页</span><button disabled={!data.hasMore || write.busy} onClick={(): void => setPage(page + 1)}>下一页</button></div></>}
    </section>{workspacePortal !== 'admin' && <section className={styles.card}><h2>{data?.canCreate ? workspacePortal === 'teacher' ? '创建课程' : '创建班级' : '邀请码加入'}</h2>{data && <form onSubmit={submit} onChange={(): void => setDirty(true)}><fieldset disabled={write.busy || loading}>{data.canCreate ? <><label>{workspacePortal === 'teacher' ? '课程名称' : '班级名称'}<input name="title" maxLength={100} required placeholder="例如：高等数学一班" /></label><label>{workspacePortal === 'teacher' ? '课程介绍' : '班级介绍'}<textarea name="description" maxLength={2000} rows={4} /></label><p>创建后由你负责管理并生成邀请码；不会自动共享私人资料。</p></> : <><label>邀请码<input name="code" required minLength={22} maxLength={22} autoComplete="off" spellCheck={false} /></label><label className={styles.check}><input name="confirmed" type="checkbox" required />我确认主动加入该班级</label><p>只有负责人提供的有效邀请码可用。已被移除时需联系负责人恢复。</p></>}<button className={styles.primary} type="submit">{write.busy ? '正在保存…' : data.canCreate ? workspacePortal === 'teacher' ? '创建课程' : '创建班级' : '加入班级'}</button></fieldset></form>}</section>}</div>
  </div></Shell>;
}
type FormKind = 'chapter' | 'assignment' | 'class';
type WorkspaceTab = 'overview' | 'chapter' | 'assignment' | 'settings';
export function ClassroomDetail({ id, management = false, portal }: { id: string; management?: boolean; portal?: WorkspacePortal }): ReactElement {
  const workspacePortal = portal ?? (management ? 'admin' : 'student');
  const managementBase = managerBase(workspacePortal);
  const router = useRouter(), write = useWrite();
  const [view, setView] = useState<ClassDetail | null>(null), [sources, setSources] = useState<ClassSources | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [sourceError, setSourceError] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>(workspacePortal === 'teacher' ? 'overview' : 'chapter'), [editId, setEditId] = useState<string | null>(null), [dirty, setDirty] = useState(false), [formKey, setFormKey] = useState(0), [code, setCode] = useState(''), [readAt, setReadAt] = useState(0), [sourceId, setSourceId] = useState('');
  useUnsaved(dirty);
  const refresh = useCallback(async (): Promise<ClassDetail> => { const result = await classrooms.read(id); setView(result); setReadAt(Date.now()); setError(''); return result; }, [id]);
  useEffect((): (() => void) => { let active = true; setLoading(true); void classrooms.read(id).then((result): void => { if (active) { setView(result); setReadAt(Date.now()); setError(''); } }).catch((reason: unknown): void => { if (active) setError(errorText(reason)); }).finally((): void => { if (active) setLoading(false); }); return (): void => { active = false; }; }, [id]);
  const loadSources = useCallback(async (page = 1): Promise<void> => { setSourceError(''); try { setSources(await classrooms.sources(id, page)); } catch (reason) { setSourceError(errorText(reason)); } }, [id]);
  useEffect((): void => { if (view?.canManage && !sources) void loadSources(); }, [view?.canManage, sources, loadSources]);
  const switchForm = (next: typeof tab, entity: string | null = null): void => { if (write.busy || (dirty && !window.confirm('放弃当前未保存输入，切换内容吗？'))) return; setDirty(false); setSourceId(view?.chapters.find((row): boolean => row.id === entity)?.sharedCourseId ?? ''); setEditId(entity); setTab(next); setFormKey((n): number => n + 1); };
  const perform = (input: ClassCommand, reset = false): void => { void write.run(input, (requestId): Promise<ClassResult> => classrooms.command(id, { ...input, requestId }), async (result): Promise<void> => {
    if (input.action === 'leave') { setDirty(false); router.push('/classes'); return; }
    if (input.action === 'invite') setCode(result.code ?? '');
    if (input.action === 'archive' || input.action === 'revoke') setCode('');
    if (result.replayed && input.action === 'invite' && !result.code) write.setError('邀请码先前已创建，原码不再展示；如需新码，请明确重新生成。');
    await refresh();
    if (reset) { setDirty(false); setSourceId(''); setEditId(null); setFormKey((n): number => n + 1); }
  }); };
  const common = (): { requestId: string; expectedRevision: number } => ({ requestId: '', expectedRevision: view?.classroom.revision ?? 0 });
  const confirmCommand = (input: ClassCommand, message: string): void => { if (dirty) { write.setError('请先保存当前输入，或切换面板明确放弃，再进行其它操作。'); return; } if (window.confirm(message)) perform(input); };
  const saveForm = (event: FormEvent<HTMLFormElement>, kind: FormKind): void => {
    event.preventDefault(); if (!view) return; const form = new FormData(event.currentTarget);
    if (kind === 'class') { perform({ ...common(), action: 'class', title: text(form, 'title'), description: text(form, 'description') }, true); return; }
    const entity = kind === 'chapter' ? view.chapters.find((row): boolean => row.id === editId) : view.assignments.find((row): boolean => row.id === editId);
    const shared = { ...common(), ...(editId ? { id: editId, entityRevision: entity?.revision } : {}), title: text(form, 'title'), publishConfirmed: form.has('publishConfirmed') };
    if (kind === 'chapter') perform({ ...shared, action: 'chapter', body: text(form, 'body'), sequence: Number(form.get('sequence')), state: text(form, 'state') as 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN', sharedCourseId: text(form, 'source') || null }, true);
    else { const due = text(form, 'dueAt'); if (due && !Number.isFinite(new Date(due).getTime())) { write.setError('截止时间无效'); return; } perform({ ...shared, action: 'assignment', instructions: text(form, 'instructions'), chapterId: text(form, 'chapter') || null, state: text(form, 'state') as 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'WITHDRAWN', dueAt: due ? new Date(due).toISOString() : null }, true); }
  };
  const room = view?.classroom, manager = view?.canManage === true, archived = room?.state === 'ARCHIVED';
  const chapter = view?.chapters.find((row): boolean => row.id === editId), task = view?.assignments.find((row): boolean => row.id === editId);
  const tabItems: Array<{ kind: WorkspaceTab; label: string }> = [];
  if (workspacePortal === 'teacher' && manager) tabItems.push({ kind: 'overview', label: '课程概览' });
  tabItems.push({ kind: 'chapter', label: '课程章节' }, { kind: 'assignment', label: '学习任务' });
  if (manager) tabItems.push({ kind: 'settings', label: workspacePortal === 'teacher' ? '学生与设置' : '成员与设置' });
  return <Shell portal={workspacePortal}><div className={styles.workspace}>
    <Link href={managementBase}>← 返回{workspacePortal === 'teacher' ? '我的课程' : '班级列表'}</Link>
    {loading && <p role="status">正在读取班级…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
    {!loading && !view && <button onClick={(): void => { setLoading(true); void refresh().catch((reason: unknown): void => setError(errorText(reason))).finally((): void => setLoading(false)); }}>重新读取</button>}
    {view && room && <><header><div className={styles.row}><h1>{room.title}</h1><span className={styles.badge}>{labels[room.state]}</span></div><p>{room.description || '暂无班级介绍'}</p><div className={styles.row}><span>{view.memberCount}名{workspacePortal === 'teacher' ? '有效学生' : '有效成员'} · {manager ? '负责人视图' : '学生视图'}</span><button disabled={write.busy || loading} onClick={(): void => { if (dirty && !window.confirm('重新读取将放弃当前未保存输入，确定吗？')) return; setLoading(true); void refresh().then((result): void => { setDirty(false); setSourceId(result.chapters.find((row): boolean => row.id === editId)?.sharedCourseId ?? ''); setFormKey((n): number => n + 1); setError(''); }).catch((reason: unknown): void => setError(errorText(reason))).finally((): void => setLoading(false)); }}>重新读取</button></div></header>
    {archived && <p role="status" className={styles.notice}>班级已归档，已发布内容仍可阅读；恢复后需重新生成邀请码。</p>}
    {write.error && <p role="alert" className={styles.error}>{write.error}</p>}{write.message && <p role="status" className={styles.notice}>{write.message}</p>}
    {dirty && <p className={styles.notice}>有未保存输入。修改后请点击对应的保存按钮。</p>}
    <nav className={styles.tabs} aria-label={workspacePortal === 'teacher' ? '课程空间' : '班级内容'}>{tabItems.map(({ kind, label }): ReactElement => <button key={kind} aria-current={tab === kind ? 'page' : undefined} disabled={write.busy} onClick={(): void => switchForm(kind)}>{label}</button>)}</nav>
    <div className={manager && tab !== 'overview' ? styles.columns : styles.stack}><section className={styles.card}>
    {tab === 'overview' && workspacePortal === 'teacher' && <><div className={styles.row}><h2>课程概览</h2><span className={styles.badge}>{labels[room.state]}</span></div><p>{room.description || '还没有添加课程介绍。你可以在“学生与设置”中完善课程信息。'}</p><div className={styles.overviewGrid} aria-label="课程数据"><article><strong>{view.memberCount}</strong><span>有效学生</span></article><article><strong>{view.chapters.length}</strong><span>章节</span></article><article><strong>{view.assignments.length}</strong><span>学习任务</span></article></div><p>章节和任务数量包含草稿；学生人数只统计当前有效成员。</p><div className={styles.courseShortcuts}><button type="button" onClick={(): void => switchForm('chapter')}>查看课程章节 →</button><button type="button" onClick={(): void => switchForm('assignment')}>查看学习任务 →</button><button type="button" onClick={(): void => switchForm('settings')}>学生与邀请码 →</button></div></>}
    {tab === 'chapter' && <><div className={styles.row}><h2>课程章节 · {view.chapters.length}</h2>{manager && <button disabled={write.busy || archived} onClick={(): void => switchForm('chapter')}>新建章节</button>}</div>{!view.chapters.length && <p>{manager ? '尚无章节，可先保存草稿，再确认发布。' : '负责人尚未发布章节。'}</p>}<div className={styles.stack}>{view.chapters.map((row): ReactElement => <article key={row.id} className={styles.item}><span className={styles.badge}>{labels[row.state]}</span><h3>{row.sequence + 1}. {row.title}</h3><p className={styles.body}>{row.body || '暂无章节说明'}</p>{row.sourceAvailable && row.sharedCourseId ? <Link href={'/courses/' + row.sharedCourseId}>阅读本章资料 →</Link> : <p>本章暂无可用资料链接。</p>}{manager && <button disabled={write.busy || archived} onClick={(): void => switchForm('chapter', row.id)}>编辑章节</button>}</article>)}</div></>}
    {tab === 'assignment' && <><div className={styles.row}><h2>学习任务 · {view.assignments.length}</h2>{manager && <button disabled={write.busy || archived} onClick={(): void => switchForm('assignment')}>新建任务</button>}</div><p>打开任务可保存草稿、提交作业或查看批阅；负责人可查看真实提交与反馈。</p>{!view.assignments.length && <p>{manager ? '尚无任务。' : '暂无可读的已发布任务。'}</p>}<div className={styles.stack}>{view.assignments.map((row): ReactElement => <article className={styles.item} key={row.id}><span className={styles.badge}>{labels[row.state]}</span><h3>{row.title}</h3><p>{row.chapterId ? '章节：' + (view.chapters.find((c): boolean => c.id === row.chapterId)?.title ?? '关联章节暂不可见') : '班级独立任务'}</p><p>截止：{row.dueAt ? date(row.dueAt) : '尚未设置'}{row.dueAt && Date.parse(row.dueAt) <= readAt ? '（已截止）' : ''}</p><p className={styles.body}>{row.instructions || '暂无任务说明'}</p><Link href={managementBase + '/assignments/' + row.id}>查看任务与作业 →</Link>{manager && <button disabled={write.busy || archived} onClick={(): void => switchForm('assignment', row.id)}>编辑任务</button>}</article>)}</div></>}
    {tab === 'settings' && manager && <><h2>{workspacePortal === 'teacher' ? '课程学生' : '成员'}</h2><p>学生主动加入后出现在这里；移除保留历史，恢复只对原成员生效。</p>{!view.members.length && <p>暂无成员。</p>}<div className={styles.stack}>{view.members.map((member): ReactElement => <article className={styles.item} key={member.studentId}><strong>{member.nickname || '未命名学生'}</strong><p>{member.state === 'ACTIVE' ? '有效成员' : labels[member.state]}</p><button disabled={write.busy || archived} onClick={(): void => confirmCommand({ ...common(), action: 'member', studentId: member.studentId, memberRevision: member.revision, state: member.state === 'ACTIVE' ? 'REMOVED' : 'ACTIVE', confirmed: true }, member.state === 'ACTIVE' ? '移除该成员？其正式历史将保留。' : '恢复该学生的班级访问权限？')}>{member.state === 'ACTIVE' ? '移除成员' : '恢复成员'}</button></article>)}</div><h2>学生邀请码</h2><p>新码会立即撤销旧码；原码仅本次显示，请自行安全交给学生。</p><form onSubmit={(event): void => { event.preventDefault(); const f = new FormData(event.currentTarget); confirmCommand({ ...common(), action: 'invite', days: Number(f.get('days')), maxUses: Number(f.get('uses')), confirmed: true }, '生成新邀请码并立即撤销旧码？'); }}><fieldset disabled={write.busy || archived}><label>有效天数<input type="number" min={1} max={30} name="days" defaultValue={7} required /></label><label>最多加入人数<input type="number" min={1} max={5000} name="uses" defaultValue={50} required /></label><button type="submit">生成新邀请码</button></fieldset></form>{code && <div className={styles.notice}><p>本次邀请码（仅此处显示）</p><code className={styles.code}>{code}</code><button disabled={write.busy} onClick={(): void => { void navigator.clipboard.writeText(code).catch((): void => write.setError('复制未成功，请手动选中邀请码复制')); }}>复制邀请码</button></div>}{view.invites.map((invite): ReactElement => <article className={styles.item} key={invite.id}><p>{invite.revokedAt ? '已撤销' : Date.parse(invite.expiresAt) <= readAt ? '已到期' : invite.usedCount >= invite.maxUses ? '已用尽' : '有效'} · {invite.usedCount}/{invite.maxUses}次 · 到期{date(invite.expiresAt)}</p>{!invite.revokedAt && <button disabled={write.busy || archived} onClick={(): void => confirmCommand({ ...common(), action: 'revoke', inviteId: invite.id }, '撤销该邀请码？')}>撤销</button>}</article>)}</>}
    </section>
    {manager && tab !== 'overview' && <aside className={styles.card} key={tab + ':' + formKey}>
      {tab === 'settings' ? <><h2>{workspacePortal === 'teacher' ? '课程设置' : '班级设置'}</h2><form onChange={(): void => setDirty(true)} onSubmit={(event): void => saveForm(event, 'class')}><fieldset disabled={write.busy || archived}><label>{workspacePortal === 'teacher' ? '课程名称' : '班级名称'}<input name="title" defaultValue={room.title} maxLength={100} required /></label><label>班级介绍<textarea name="description" defaultValue={room.description} maxLength={2000} rows={5} /></label><button type="submit" className={styles.primary}>保存{workspacePortal === 'teacher' ? '课程' : '班级'}</button></fieldset></form><button disabled={write.busy} onClick={(): void => confirmCommand({ ...common(), action: 'archive', state: archived ? 'ACTIVE' : 'ARCHIVED', confirmed: true }, archived ? '恢复后旧邀请码不会恢复。' : '归档后旧邀请码会撤销，成员仍能阅读已发布内容。')}>{archived ? '恢复' + (workspacePortal === 'teacher' ? '课程' : '班级') : '归档' + (workspacePortal === 'teacher' ? '课程' : '班级')}</button></> : <><h2>{editId ? '编辑' : '新建'}{tab === 'chapter' ? '章节' : '任务'}</h2><form onChange={(): void => setDirty(true)} onSubmit={(event): void => saveForm(event, tab)}><fieldset disabled={write.busy || archived}>
      <label>标题<input name="title" defaultValue={(tab === 'chapter' ? chapter : task)?.title ?? ''} maxLength={100} required /></label>
      {tab === 'chapter' ? <><label>顺序（从0开始）<input name="sequence" type="number" min={0} max={9999} defaultValue={chapter?.sequence ?? (view.chapters.length ? Math.max(...view.chapters.map((c): number => c.sequence)) + 1 : 0)} required /></label><label>章节说明<textarea name="body" rows={7} maxLength={20000} defaultValue={chapter?.body ?? ''} /></label><label>授权课程资料<select name="source" value={sourceId} onChange={(event): void => setSourceId(event.target.value)}><option value="">不绑定资料</option>{sourceId && !sources?.items.some((s): boolean => s.id === sourceId) && <option value={sourceId}>保留当前授权资料</option>}{sources?.items.map((source): ReactElement => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label><p>仅可选择已发布的授权共享课程。私人资料需先走独立的授权发布流程。</p>{sourceError && <p role="alert" className={styles.error}>{sourceError}</p>}<div className={styles.row}><button type="button" disabled={!sources || sources.page <= 1 || write.busy} onClick={(): void => { void loadSources((sources?.page ?? 1) - 1); }}>上一批资料</button><button type="button" disabled={!sources?.hasMore || write.busy} onClick={(): void => { void loadSources((sources?.page ?? 1) + 1); }}>下一批资料</button><button type="button" onClick={(): void => { void loadSources(); }}>重读资料</button></div></> : <><label>关联章节<select name="chapter" defaultValue={task?.chapterId ?? ''}><option value="">班级独立任务</option>{view.chapters.map((row): ReactElement => <option key={row.id} value={row.id}>{row.title}（{labels[row.state]}）</option>)}</select></label><p>关联章节未发布时，学生看不到该任务。</p><label>任务要求<textarea name="instructions" rows={7} maxLength={20000} defaultValue={task?.instructions ?? ''} /></label><label>截止时间（本机时区）<input name="dueAt" type="datetime-local" defaultValue={localDate(task?.dueAt ?? null)} /></label></>}
      <label>状态<select name="state" defaultValue={(tab === 'chapter' ? chapter : task)?.state ?? 'DRAFT'}><option value="DRAFT">草稿</option><option value="PUBLISHED">发布</option>{tab === 'assignment' && <option value="CLOSED">关闭（可读，不可提交）</option>}<option value="WITHDRAWN">撤回（学生不可读）</option></select></label><label className={styles.check}><input type="checkbox" name="publishConfirmed" />我确认发布或修改原已发布内容，学生将按新状态查看。</label><button type="submit" className={styles.primary}>{write.busy ? '正在保存…' : '保存' + (tab === 'chapter' ? '章节' : '任务')}</button></fieldset></form></>}
    </aside>}
    </div>{!manager && <section className={styles.card}><p>退出后不能继续读取班级；再次加入需要有效邀请码。已正式提交的历史可在“我的提交与反馈”中查看。</p><button disabled={write.busy} onClick={(): void => confirmCommand({ ...common(), action: 'leave', confirmed: true }, '确定退出本班？')}>退出班级</button></section>}</>}
  </div></Shell>;
}






