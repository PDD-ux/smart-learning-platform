'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { CourseReader } from '@/components/courses/CourseReader';
import { api, type AdminCourse, type AdminCourseSummary, type CourseList, type ContentSummary, type PrepareCourse } from '@/services/api';

const emptyInclude: PrepareCourse['include'] = { transcripts: false, textBlocks: false, knowledgePoints: false, generatedNote: false };
const includeLabels = { transcripts: '转写原文', textBlocks: '正文与OCR', knowledgePoints: '知识重点', generatedNote: '已有AI整理笔记' };
const stateLabels = { DRAFT: '未发布草稿', PUBLISHED: '已发布', WITHDRAWN: '已下架' };
export function SharedCoursesWorkspace({ mode }: { mode: 'teacher' | 'admin' }): ReactElement {
  const [sources, setSources] = useState<ContentSummary[]>([]), [sourcesError, setSourcesError] = useState('');
  const [sourceId, setSourceId] = useState(''), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [rights, setRights] = useState(''), [confirmed, setConfirmed] = useState(false), [include, setInclude] = useState(emptyInclude);
  const [preview, setPreview] = useState<AdminCourse | null>(null), [publishConfirmed, setPublishConfirmed] = useState(false), [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const [result, setResult] = useState<CourseList<AdminCourseSummary> | null>(null), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), requestId = useRef<string | null>(null), active = useRef(true);
  useEffect(() => { active.current = true; return (): void => { active.current = false; }; }, []);
  useEffect(() => { if (mode !== 'teacher') return; let current = true; setSourcesError(''); void api.contents().then((value): void => { if (current) setSources(value.items.filter((item): boolean => item.status === '已就绪')); }).catch((): void => { if (current) setSourcesError('本人资料读取失败，请刷新'); }); return (): void => { current = false; }; }, [mode, revision]);
  useEffect(() => { let current = true; setLoading(true); setError(''); void api.adminCourses(page).then((value): void => { if (current) setResult(value); }).catch((): void => { if (current) setError('课程列表读取失败，请刷新重试'); }).finally((): void => { if (current) setLoading(false); }); return (): void => { current = false; }; }, [page, revision]);
  function draftChanged(): void { requestId.current = null; }
  async function openPreview(id: string): Promise<void> {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const course = await api.adminCourse(id); if (active.current) { setPreview(course); setPublishConfirmed(false); setWithdrawConfirmed(false); } }
    catch (cause: unknown) { if (active.current) setError(cause instanceof Error ? cause.message : '预览读取失败'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  async function write(action: 'prepare' | 'publish' | 'withdraw'): Promise<void> {
    if (mode === 'admin' && action !== 'withdraw') return;
    if (lock.current || (action === 'publish' && !publishConfirmed) || (action === 'withdraw' && !withdrawConfirmed)) return;
    if (action === 'prepare' && (!confirmed || !rights.trim() || !sourceId || !title.trim())) { setError('请完整填写本人资料、标题和传播授权'); return; }
    if (action !== 'prepare' && !preview) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let updated: AdminCourse;
      if (action === 'prepare') {
        requestId.current ??= crypto.randomUUID();
        updated = await api.prepareCourse({ sourceContentId: sourceId, title, description, rightsConfirmed: true, rightsStatement: rights, include, requestId: requestId.current });
      } else { updated = await api.changeCourse(preview!.courseId, preview!.version, action); }
      if (!active.current) return;
      setPreview(updated); setPublishConfirmed(false); setWithdrawConfirmed(false); setRevision((value): number => value + 1);
      setNotice(action === 'prepare' ? '副本准备成功，尚未公开。请核对下面完整预览后再确认发布。' : action === 'publish' ? '课程已发布，学习者可从学习中心的共享课程阅读。' : '课程已下架，后续媒体请求会被拒绝。');
    } catch (cause: unknown) { if (active.current) setError(cause instanceof Error ? cause.message : '操作失败，输入已保留'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  const PortalShell = mode === 'teacher' ? TeacherShell : AdminShell;
  return <PortalShell><div className="shared-courses"><header><h1>{mode === 'teacher' ? '授权课程资料' : '共享课程治理'}</h1><p>{mode === 'teacher' ? '只选择本人持有、已就绪且获传播授权的资料。先准备独立副本，再核对预览并明确发布；原资料仍然私人。' : '平台管理员仅处理已发布共享课程的下架。本人资料授权、课程副本准备和发布由教师在教师工作台完成。'}</p><button disabled={busy || loading} onClick={(): void => setRevision((value): number => value + 1)}>{mode === 'teacher' ? '刷新课程与本人资料' : '刷新共享课程列表'}</button></header>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
    {mode === 'teacher' ? <section className="shared-course-card" aria-label="准备共享课程"><h2>1 · 选择发布范围并准备副本</h2>{sourcesError ? <p role="alert">{sourcesError}</p> : sources.length === 0 ? <p>当前账号暂无已就绪的本人资料。不能选择其他用户的私人资料。<Link className="learner-text-action" href="/import">导入本人授权资料 →</Link></p> : null}
      <fieldset disabled={busy || preview !== null}><label>本人已就绪资料<select value={sourceId} onChange={(event): void => { setSourceId(event.target.value); setTitle(sources.find((item): boolean => item.contentId === event.target.value)?.title ?? ''); draftChanged(); }}><option value="">请选择本人资料</option>{sources.map((source): ReactElement => <option key={source.contentId} value={source.contentId}>{source.title}</option>)}</select></label><label>共享课程标题<input value={title} maxLength={120} onChange={(event): void => { setTitle(event.target.value); draftChanged(); }} /></label><label>课程简介<textarea maxLength={2000} value={description} onChange={(event): void => { setDescription(event.target.value); draftChanged(); }} /></label><p>原媒体将复制到独立私有前缀；以下解析内容默认不公开，按需明确选择。个人笔记、问答、成绩、题库与人脸信息不复制。</p><div className="shared-course-actions">{(Object.keys(includeLabels) as Array<keyof typeof includeLabels>).map((key): ReactElement => <label className="shared-check" key={key}><input type="checkbox" checked={include[key]} onChange={(event): void => { setInclude((value) => ({ ...value, [key]: event.target.checked })); draftChanged(); }} />{includeLabels[key]}</label>)}</div><label>传播授权说明<textarea maxLength={500} value={rights} onChange={(event): void => { setRights(event.target.value); draftChanged(); }} /></label><label className="shared-check"><input type="checkbox" checked={confirmed} onChange={(event): void => { setConfirmed(event.target.checked); draftChanged(); }} />我持有该资料及所选内容的传播授权，允许平台登录用户阅读</label><button disabled={!sourceId || !title.trim() || !rights.trim() || !confirmed} onClick={(): void => { void write('prepare'); }}>准备独立副本（尚不公开）</button></fieldset>
      {busy ? <p role="status">正在处理，请勿重复提交。PDF将准备全部页图，可能需要较长时间。</p> : null}
      {preview ? <button disabled={busy} onClick={(): void => { setPreview(null); setPublishConfirmed(false); setWithdrawConfirmed(false); requestId.current = null; }}>新建另一个课程</button> : null}
    </section> : null}
    {preview ? <section className="shared-course-card" aria-label="共享课程发布预览"><h2>2 · 核对独立副本预览</h2><h3>{preview.title}</h3><p>{stateLabels[preview.state]} · 版本 {preview.version} · {preview.prepared ? '副本已完整准备' : '准备未完成，不能发布'}</p><p>{preview.description}</p><p>授权说明：{preview.rightsStatement}</p><p>选取公开内容：{(Object.keys(includeLabels) as Array<keyof typeof includeLabels>).filter((key): boolean => preview.include[key]).map((key): string => includeLabels[key]).join('、') || '仅原媒体'}</p><button disabled={busy} onClick={(): void => { void openPreview(preview.courseId); }}>重新读取此副本状态</button><CourseReader key={`${preview.courseId}:${preview.version}`} course={preview} />
      {mode === 'teacher' && preview.state !== 'PUBLISHED' && preview.canPublish ? <><label className="shared-check"><input type="checkbox" disabled={busy} checked={publishConfirmed} onChange={(event): void => setPublishConfirmed(event.target.checked)} />我已核对实际媒体、所选快照及授权范围，确认向登录用户发布</label><button disabled={busy || !publishConfirmed || !preview.prepared} onClick={(): void => { void write('publish'); }}>确认发布课程</button></> : preview.state === 'PUBLISHED' ? <><p>下架后新请求不可读，已经接收的字节、截图或副本无法追回。</p><label className="shared-check"><input disabled={busy} type="checkbox" checked={withdrawConfirmed} onChange={(event): void => setWithdrawConfirmed(event.target.checked)} />确认下架该课程</label><button disabled={busy || !withdrawConfirmed} onClick={(): void => { void write('withdraw'); }}>确认下架课程</button></> : <p>{mode === 'admin' ? '管理员治理入口只允许下架已发布课程，不能准备或重新发布课程。' : '此共享副本已下架，仅原发布者可以重新发布。'}</p>}
    </section> : null}
    <section className="shared-course-card" aria-label="共享副本管理列表"><h2>{mode === 'teacher' ? '本人共享副本' : '已发布课程治理'}</h2>{loading ? <p role="status">正在读取课程列表…</p> : result ? <><p>{mode === 'teacher' ? `共 ${result.total} 门；仅本人草稿及已发布副本可管理。` : `共 ${result.total} 门可见课程；平台管理员只能下架已发布内容。`}</p>{result.items.map((item): ReactElement => <article key={item.courseId}><h3>{item.title}</h3><p>{stateLabels[item.state]} · {item.prepared ? '准备完成' : '准备中断或尚未完成'}</p><button disabled={busy || !item.prepared} onClick={(): void => { void openPreview(item.courseId); }}>查看课程 · {item.title}</button></article>)}<nav aria-label="管理课程分页"><button disabled={busy || page <= 1} onClick={(): void => setPage((value): number => value - 1)}>上一页</button><span>第 {page} 页</span><button disabled={busy || result.page * result.pageSize >= result.total} onClick={(): void => setPage((value): number => value + 1)}>下一页</button></nav></> : null}</section>
  </div></PortalShell>;
}

export default function AdminCoursesPage(): ReactElement { return <SharedCoursesWorkspace mode="admin" />; }
