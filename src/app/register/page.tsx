'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';

import { AuthShell } from '@/components/auth/AuthShell';
import { calcStrength } from '@/lib/password-strength';
import { ApiClientError, apiRequest, setAccessToken } from '@/services/api';

type RegisterResponse = { accessToken: string; redirect: string };
type CodeResponse = { devCode?: string; expiresIn: number };
type RegisterField = 'account' | 'nickname' | 'password' | 'confirm' | 'code' | 'agree';
type FieldErrors = Partial<Record<RegisterField, string>>;

const fieldOrder: RegisterField[] = ['account', 'nickname', 'password', 'confirm', 'code', 'agree'];

function validateField(field: RegisterField, form: { account: string; nickname: string; password: string; confirm: string; code: string; agree: boolean }): string {
  switch (field) {
    case 'account': {
      const account = form.account.trim();
      return !account ? '请输入邮箱或手机号' : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || /^1[3-9]\d{9}$/.test(account.replace(/[\s-]/g, ''))) ? '' : '请输入正确的邮箱或中国大陆手机号';
    }
    case 'nickname': return form.nickname.trim().length < 2 ? '昵称至少需要 2 个字' : form.nickname.trim().length > 20 ? '昵称最多 20 个字' : '';
    case 'password': return form.password.length < 8 ? '密码至少需要 8 位' : form.password.length > 72 ? '密码最多 72 位' : '';
    case 'confirm': return form.confirm !== form.password ? '两次输入的密码不一致' : '';
    case 'code': return /^\d{6}$/.test(form.code) ? '' : '请输入 6 位数字验证码';
    case 'agree': return form.agree ? '' : '请先勾选并同意用户协议与隐私说明';
  }
}

function getServerFieldErrors(reason: unknown): FieldErrors {
  if (!(reason instanceof ApiClientError) || typeof reason.details !== 'object' || reason.details === null) return {};
  const details = reason.details as Record<string, unknown>;
  return fieldOrder.reduce<FieldErrors>((errors, field) => {
    const messages = details[field];
    if (Array.isArray(messages) && typeof messages[0] === 'string') errors[field] = messages[0];
    return errors;
  }, {});
}

export default function RegisterPage(): ReactElement {
  const router = useRouter();
  const [form, setForm] = useState({ account: '', nickname: '', password: '', confirm: '', code: '', agree: false });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const strength = useMemo(() => calcStrength(form.password), [form.password]);

  const update = (key: keyof typeof form, value: string | boolean): void => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      setFieldErrors((errors) => {
        if (key === 'password' && errors.confirm) return { ...errors, password: validateField('password', next), confirm: validateField('confirm', next) };
        if (key === 'agree') return { ...errors, agree: validateField('agree', next) };
        return { ...errors, [key]: validateField(key, next) };
      });
      return next;
    });
  };
  const validateOnBlur = (field: RegisterField): void => setFieldErrors((current) => ({ ...current, [field]: validateField(field, form) }));
  const validateAll = (): FieldErrors => fieldOrder.reduce<FieldErrors>((errors, field) => {
    const message = validateField(field, form);
    if (message) errors[field] = message;
    return errors;
  }, {});
  const sendCode = async (): Promise<void> => {
    setError('');
    const accountError = validateField('account', form);
    if (accountError) {
      setFieldErrors((errors) => ({ ...errors, account: accountError }));
      return;
    }
    setCodeBusy(true);
    try {
      const result = await apiRequest<CodeResponse>('/api/auth/send-code', { method: 'POST', body: { account: form.account } });
      setDevCode(result.devCode ?? '');
      if (result.devCode) update('code', result.devCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码发送失败');
    } finally {
      setCodeBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    const errors = validateAll();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      const result = await apiRequest<RegisterResponse>('/api/auth/register', { method: 'POST', body: form });
      setAccessToken(result.accessToken);
      router.replace(result.redirect);
    } catch (reason) {
      const serverErrors = getServerFieldErrors(reason);
      if (Object.keys(serverErrors).length > 0) {
        setFieldErrors(serverErrors);
        setError('请检查标红的填写项');
      } else setError(reason instanceof Error ? reason.message : '注册失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="创建学习账号" hint="邮箱和手机号均可注册，验证码为本地演示通道。">
      <form className="auth-form auth-form-register" onSubmit={(event) => void submit(event)}>
        <label className="auth-label">邮箱或手机号<input required value={form.account} onBlur={() => validateOnBlur('account')} onChange={(event) => update('account', event.target.value)} aria-invalid={Boolean(fieldErrors.account)} aria-describedby={fieldErrors.account ? 'register-account-error' : undefined} className={`auth-input${fieldErrors.account ? ' is-invalid' : ''}`} />{fieldErrors.account ? <span id="register-account-error" className="auth-field-error">{fieldErrors.account}</span> : null}</label>
        <label className="auth-label">昵称<input required value={form.nickname} onBlur={() => validateOnBlur('nickname')} onChange={(event) => update('nickname', event.target.value)} aria-invalid={Boolean(fieldErrors.nickname)} aria-describedby={fieldErrors.nickname ? 'register-nickname-error' : undefined} className={`auth-input${fieldErrors.nickname ? ' is-invalid' : ''}`} />{fieldErrors.nickname ? <span id="register-nickname-error" className="auth-field-error">{fieldErrors.nickname}</span> : <span className="auth-field-hint">2–20 个字</span>}</label>
        <label className="auth-label">密码<input required type="password" value={form.password} onBlur={() => validateOnBlur('password')} onChange={(event) => update('password', event.target.value)} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'register-password-error' : undefined} className={`auth-input${fieldErrors.password ? ' is-invalid' : ''}`} />{fieldErrors.password ? <span id="register-password-error" className="auth-field-error">{fieldErrors.password}</span> : null}{form.password ? <span className={`auth-strength ${strength.textClass}`}>密码强度：{strength.label}<span className="auth-strength-track"><span className={strength.barClass} style={{ width: `${strength.percent}%` }} /></span></span> : <span className="auth-field-hint">至少 8 位</span>}</label>
        <label className="auth-label">确认密码<input required type="password" value={form.confirm} onBlur={() => validateOnBlur('confirm')} onChange={(event) => update('confirm', event.target.value)} aria-invalid={Boolean(fieldErrors.confirm)} aria-describedby={fieldErrors.confirm ? 'register-confirm-error' : undefined} className={`auth-input${fieldErrors.confirm ? ' is-invalid' : ''}`} />{fieldErrors.confirm ? <span id="register-confirm-error" className="auth-field-error">{fieldErrors.confirm}</span> : null}</label>
        <label className="auth-label">验证码<div className="auth-code-row"><input required inputMode="numeric" maxLength={6} value={form.code} onBlur={() => validateOnBlur('code')} onChange={(event) => update('code', event.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={Boolean(fieldErrors.code)} aria-describedby={fieldErrors.code ? 'register-code-error' : undefined} className={`auth-input${fieldErrors.code ? ' is-invalid' : ''}`} /><button type="button" disabled={codeBusy} onClick={() => void sendCode()} className="auth-code-button">{codeBusy ? '发送中' : '获取验证码'}</button></div>{fieldErrors.code ? <span id="register-code-error" className="auth-field-error">{fieldErrors.code}</span> : null}{devCode ? <span className="auth-dev-code">演示验证码：{devCode}（已自动填入）</span> : null}</label>
        <label className={`auth-check auth-agree${fieldErrors.agree ? ' is-invalid' : ''}`}><input type="checkbox" checked={form.agree} onBlur={() => validateOnBlur('agree')} onChange={(event) => update('agree', event.target.checked)} aria-invalid={Boolean(fieldErrors.agree)} aria-describedby={fieldErrors.agree ? 'register-agree-error' : undefined} />我已阅读并同意用户协议与隐私说明</label>{fieldErrors.agree ? <span id="register-agree-error" className="auth-field-error auth-agree-error">{fieldErrors.agree}</span> : null}
        {error ? <p className="auth-error">{error}</p> : null}
        <button disabled={busy} className="auth-primary-button">{busy ? '注册中…' : '注册并开始学习'}<span>→</span></button>
        <p className="auth-switch">已有账号？<Link href="/login">返回登录</Link></p>
      </form>
    </AuthShell>
  );
}
