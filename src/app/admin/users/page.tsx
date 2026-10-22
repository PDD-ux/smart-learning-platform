'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { api, ApiClientError, type AdminUser } from '@/services/api';

type UserRole = 'admin' | 'teacher' | 'student';
type UserDraft = { account: string; nickname: string; password: string; role: UserRole };

const emptyDraft: UserDraft = { account: '', nickname: '', password: '', role: 'student' };

function roleLabel(role: UserRole): string {
  return role === 'admin' ? '管理员' : role === 'teacher' ? '教师' : '学习者';
}

function displayAccount(user: AdminUser): string {
  return user.email ?? user.phone ?? '未设置账号';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function AdminUsersPage(): ReactElement {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const mutationPending = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current += 1; }; }, []);
  const pageSize = 8;

  const load = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setLoading(true); setTotal(null);
    setError('');
    try {
      const result = await api.adminUsers({ query, role: role || undefined, page, pageSize });
      if (!mounted.current || version !== requestVersion.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setItems(result.items);
      setTotal(result.total);
      setForbidden(false);
    } catch (reason) {
      if (!mounted.current || version !== requestVersion.current) return;
      if (reason instanceof ApiClientError && reason.status === 403) {
        setForbidden(true);
        setError('当前账号不是管理员，无法访问用户管理。');
      } else {
        setError(reason instanceof Error ? reason.message : '用户列表加载失败');
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [page, query, role]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = (): void => {
    if (mutationPending.current) return;
    setEditing(null);
    setError('');
    setDraft(emptyDraft);
    setNotice('');
    setEditorOpen(true);
  };

  const openEdit = (user: AdminUser): void => {
    if (mutationPending.current) return;
    setEditing(user);
    setError('');
    setDraft({ account: displayAccount(user), nickname: user.nickname, password: '', role: user.role });
    setNotice('');
    setEditorOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (mutationPending.current) return;
    mutationPending.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (editing) {
        await api.updateAdminUser(editing.id, {
          nickname: draft.nickname,
          role: draft.role,
          ...(draft.password ? { password: draft.password } : {}),
        });
        if (!mounted.current) return;
        setNotice('用户信息已更新');
      } else {
        await api.createAdminUser(draft);
        if (!mounted.current) return;
        setNotice('用户创建成功');
      }
      setEditorOpen(false);
      await load();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '保存失败，请稍后重试');
    } finally {
      mutationPending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const remove = async (user: AdminUser): Promise<void> => {
    if (mutationPending.current || user.isCurrent || !window.confirm(`确定删除用户“${user.nickname}”吗？该用户的学习数据也会被删除。`)) return;
    mutationPending.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.deleteAdminUser(user.id);
      if (!mounted.current) return;
      setNotice('用户已删除');
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
      else await load();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '删除失败，请稍后重试');
    } finally { mutationPending.current = false; if (mounted.current) setSaving(false); }
  };

  const updateDraft = (key: keyof UserDraft, value: string): void => setDraft((current) => ({ ...current, [key]: value }));
  const totalPages = Math.max(1, Math.ceil((total ?? 0) / pageSize));

  return <AdminShell>
    {forbidden ? <section className="mx-auto flex min-h-96 max-w-xl items-center justify-center rounded-lg border border-rose/20 bg-surface p-8 text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-soft text-2xl text-rose">!</div><h2 className="mt-5 text-xl font-semibold">没有管理员权限</h2><p className="mt-3 text-sm leading-6 text-textSub">这个页面只对管理员开放。普通用户可以继续使用学习、笔记和复习功能。</p><Link href="/dashboard" className="mt-6 inline-flex rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">返回工作台</Link></div></section> : <div className="space-y-6">
      <section className="rounded-lg border border-glass-line bg-surface p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><span className="section-kicker">ADMIN CONSOLE</span><h2 className="section-title mt-2">账号花名册</h2><p className="section-description">{total === null ? (loading ? '正在读取账号数量…' : '账号数量暂不可用。') : `共 ${total} 个账号，管理员可以创建、编辑和删除用户。`}</p></div><button type="button" disabled={saving} onClick={openCreate} className="rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg">＋ 新增用户</button></div><div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px_auto]"><input aria-label="搜索用户" disabled={saving} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="rounded-md border border-glass-line bg-bg px-4 py-3 text-sm text-text outline-none focus:border-brand" placeholder="搜索邮箱、手机号或昵称…" /><select aria-label="筛选角色" disabled={saving} value={role} onChange={(event) => { setRole(event.target.value as UserRole | ''); setPage(1); }} className="rounded-md border border-glass-line bg-bg px-4 py-3 text-sm text-text outline-none focus:border-brand"><option value="">全部角色</option><option value="student">学习者</option><option value="teacher">教师</option><option value="admin">管理员</option></select><button type="button" disabled={saving} onClick={() => void load()} className="rounded-md border border-brand px-5 py-3 text-sm text-brand-ink">刷新列表</button></div></section>
      {notice ? <p role="status" className="rounded-md bg-teal/10 px-4 py-3 text-sm text-teal">{notice}</p> : null}
      {error && !editorOpen ? <p role="alert" className="rounded-md bg-rose-soft px-4 py-3 text-sm text-rose">{error}</p> : null}
      <section className="overflow-hidden rounded-lg border border-glass-line bg-surface"><div className="hidden grid-cols-[1.5fr_1fr_110px_140px_150px] gap-4 border-b border-glass-line px-5 py-4 text-xs text-textMute md:grid"><span>账号</span><span>昵称</span><span>角色</span><span>注册时间</span><span>操作</span></div>{loading ? <div className="p-12 text-center text-sm text-textSub">正在加载用户列表…</div> : total === null ? <div role="alert" className="p-12 text-center text-sm text-rose">用户列表读取失败，请刷新列表重试。</div> : items.length === 0 ? <div className="p-12 text-center text-sm text-textSub">没有找到符合条件的用户。</div> : <div className="divide-y divide-glass-line">{items.map((user) => <article key={user.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.5fr_1fr_110px_140px_150px] md:items-center md:gap-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-text">{displayAccount(user)}</p><p className="mt-1 truncate text-xs text-textMute">更新时间 {formatDate(user.updatedAt)}</p></div><p className="text-sm text-textSub">{user.nickname}{user.isCurrent ? '（当前账号）' : ''}</p><span className={`w-fit rounded-full px-2.5 py-1 text-xs ${user.role === 'admin' ? 'bg-brand-soft text-brand-ink' : 'bg-teal/10 text-teal'}`}>{roleLabel(user.role)}</span><p className="text-xs text-textMute">{formatDate(user.createdAt)}</p><div className="flex gap-3 text-sm"><button type="button" disabled={saving} onClick={() => openEdit(user)} className="min-h-11 text-brand-ink hover:underline">编辑</button><button type="button" disabled={saving || user.isCurrent} onClick={() => void remove(user)} className="min-h-11 text-rose hover:underline disabled:cursor-not-allowed disabled:text-textMute">删除</button></div></article>)}</div>}</section>
      <div className="flex items-center justify-between text-sm text-textSub"><span>{total === null ? '页数待读取' : `第 ${page} / ${totalPages} 页`}</span><div className="flex gap-2"><button type="button" disabled={saving || loading || total === null || page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-md border border-glass-line px-3 py-2 disabled:opacity-40">上一页</button><button type="button" disabled={loading || total === null || page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-md border border-glass-line px-3 py-2 disabled:opacity-40">下一页</button></div></div>
    </div>}
    {editorOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) setEditorOpen(false); }}><form onSubmit={(event) => void save(event)} className="w-full max-w-lg rounded-lg border border-glass-line bg-surface p-6 shadow-2xl"><div className="flex items-start justify-between"><div><span className="section-kicker">{editing ? 'EDIT ACCOUNT' : 'NEW ACCOUNT'}</span><h2 className="mt-2 text-xl font-semibold">{editing ? '编辑用户' : '新增用户'}</h2></div><button type="button" disabled={saving} onClick={() => setEditorOpen(false)} className="min-h-11 min-w-11 text-2xl text-textMute" aria-label="关闭">×</button></div>{error && <p role="alert" className="mt-3 rounded-lg bg-rose-soft p-3 text-sm text-rose">{error}</p>}<fieldset disabled={saving} className="mt-6 space-y-4"><label className="block text-sm text-textSub">邮箱或手机号<input required={!editing} disabled={Boolean(editing)} value={draft.account} onChange={(event) => updateDraft('account', event.target.value)} className="mt-2 w-full rounded-md border border-glass-line bg-bg px-4 py-3 text-text outline-none focus:border-brand disabled:opacity-60" placeholder="例如 teacher@example.com" /></label><label className="block text-sm text-textSub">昵称<input required minLength={2} maxLength={20} value={draft.nickname} onChange={(event) => updateDraft('nickname', event.target.value)} className="mt-2 w-full rounded-md border border-glass-line bg-bg px-4 py-3 text-text outline-none focus:border-brand" /></label><label className="block text-sm text-textSub">{editing ? '重置密码（留空表示不修改）' : '初始密码'}<input required={!editing} minLength={8} type="password" value={draft.password} onChange={(event) => updateDraft('password', event.target.value)} className="mt-2 w-full rounded-md border border-glass-line bg-bg px-4 py-3 text-text outline-none focus:border-brand" /></label><label className="block text-sm text-textSub">角色<select value={draft.role} onChange={(event) => updateDraft('role', event.target.value)} className="mt-2 w-full rounded-md border border-glass-line bg-bg px-4 py-3 text-text outline-none focus:border-brand"><option value="student">学习者</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label></fieldset><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditorOpen(false)} className="rounded-md border border-glass-line px-5 py-3 text-sm text-textSub">取消</button><button type="submit" disabled={saving} className="rounded-md bg-brand px-5 py-3 text-sm font-medium text-bg disabled:opacity-50">{saving ? '保存中…' : '保存用户'}</button></div></form></div> : null}
  </AdminShell>;
}

