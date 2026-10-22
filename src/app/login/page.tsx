'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';

import { FaceLoginPanel } from '@/components/auth/FaceLoginPanel';
import { AuthShell } from '@/components/auth/AuthShell';
import { apiRequest, setAccessToken } from '@/services/api';

type LoginResponse = { accessToken: string; redirect: string };

export default function LoginPage(): ReactElement {
  const router = useRouter();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'password' | 'face'>('password');
  const [faceBusy, setFaceBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await apiRequest<LoginResponse>('/api/auth/login', { method: 'POST', body: { account, password, remember } });
      setAccessToken(result.accessToken);
      router.replace(result.redirect);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="欢迎回来" hint="登录后继续你的学习进度。">
<div className="mb-5 grid grid-cols-2 gap-2" aria-label="登录方式">{(['password', 'face'] as const).map((value) => <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); setPassword(''); setFaceBusy(false); }} className={`min-h-11 rounded-md border px-4 py-2 text-sm font-medium ${mode === value ? 'border-brand bg-brand-soft text-brand-ink' : 'border-glass-line text-textSub'}`}>{value === 'password' ? '密码登录' : '人脸登录'}</button>)}</div>
      {mode === 'face' ? <p className="-mt-3 mb-4 text-xs leading-5 text-textSub">人脸登录仅供教师和学生使用；管理员请切换到密码登录。</p> : null}
      <form className="auth-form" onSubmit={(event) => { if (mode === 'password') void submit(event); else event.preventDefault(); }}>
        <label className="auth-label">邮箱或手机号<input required disabled={faceBusy} autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} className="auth-input" placeholder="name@example.com" /></label>
        {mode === 'password' ? <label className="auth-label">密码<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="auth-input" placeholder="请输入密码" /></label> : null}
        <div className="auth-form-meta"><label className="auth-check"><input type="checkbox" disabled={faceBusy} checked={remember} onChange={(event) => setRemember(event.target.checked)} />记住我</label><span>{mode === 'password' ? '登录后手动打卡' : '验证成功后自动打卡'}</span></div>
        {error ? <p className="auth-error">{error}</p> : null}
        {mode === 'password' ? <button disabled={busy} className="auth-primary-button">{busy ? '登录中…' : '登录'}<span>→</span></button> : <FaceLoginPanel account={account} remember={remember} onBusyChange={setFaceBusy} onSuccess={(token, redirect): void => { setAccessToken(token); router.replace(redirect); }} />}
        <p className="auth-switch">还没有账号？<Link href="/register">立即注册</Link></p>
      </form>
    </AuthShell>
  );
}
