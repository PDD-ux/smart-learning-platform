'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { DailyCheckInCard } from '@/components/app/DailyCheckInCard';
import { ApiClientError } from '@/services/api';
import {
  attendanceApi,
  type FaceTemplateStatus,
} from '@/services/attendance';

const CONSENT_VERSION = 'face-login-attendance-v2';

type CameraMode = 'enroll' | null;


function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function readableError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'FACE_SERVICE_UNAVAILABLE') return '自动人脸服务尚未接入或暂不可用；你仍可继续学习，并改用密码登录后普通打卡。';
    if (error.code === 'FACE_CONSENT_REQUIRED') return '请先勾选独立的人脸信息处理授权。';
    if (error.code === 'FACE_ATTENDANCE_COOLDOWN') return '尝试次数过多，请稍后再试或改用密码登录后普通打卡。';
    if (error.code === 'FACE_NOT_ENROLLED') return '请先完成独立授权和人脸录入。';
    return error.message;
  }
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。';
}

function cameraFailureMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '浏览器未获摄像头权限。请在地址栏的网站权限中允许摄像头后重试。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '没有检测到可用摄像头。请连接摄像头后刷新页面再试。';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return '摄像头正被其他程序占用。请关闭微信、会议或录屏软件后重试。';
  }
  return '摄像头权限未开启或设备不可用。人脸签到不会阻断学习，你可以直接使用密码登录后普通打卡。';
}

function captureFrame(video: HTMLVideoElement): string {
  if (video.videoWidth < 80 || video.videoHeight < 80) throw new Error('摄像头画面尚未准备好，请稍候再试。');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持画面采集。');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = canvas.toDataURL('image/jpeg', 0.85);
  canvas.width = 0;
  canvas.height = 0;
  return frame;
}

export function AttendanceSettings({ audience }: { audience: 'student' | 'teacher' }): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraGeneration = useRef(0);
  const [template, setTemplate] = useState<FaceTemplateStatus | null>(null);
  const [consented, setConsented] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>(null);
  const [cameraMessage, setCameraMessage] = useState('尚未开启摄像头。预览仅在当前页面内存中显示，不会被缓存或下载。');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const stopCamera = useCallback((): void => {
    cameraGeneration.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraMode(null);
  }, []);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setTemplate(await attendanceApi.templateStatus());
    } catch (reason) {
      setError(readableError(reason));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return stopCamera;
  }, [loadStatus, stopCamera]);

  const openCamera = async (mode: Exclude<CameraMode, null>): Promise<void> => {
    setError('');
    setNotice('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('当前浏览器不支持摄像头访问。你可以继续学习，或使用密码登录后普通打卡。');
      return;
    }
    let nextStream: MediaStream | null = null;
    stopCamera();
    const attempt = cameraGeneration.current;
    setBusy(true);
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (attempt !== cameraGeneration.current) { nextStream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = nextStream;
      const preview = videoRef.current;
      if (!preview) throw new Error('摄像头预览未准备好，请刷新页面后重试。');
      preview.srcObject = nextStream;
      await preview.play();
      if (attempt !== cameraGeneration.current) return;
      setCameraMode(mode);
      setCameraMessage(mode === 'enroll' ? '画面仅用于本次录入，提交后立即释放。请保证仅一人入镜、光线充足。' : '画面仅用于本次验证，完成后会立即关闭预览。');
    } catch (reason) {
      nextStream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraMode(null);
      setCameraMessage(cameraFailureMessage(reason));
    } finally { setBusy(false); }
  };

  const enroll = async (): Promise<void> => {
    if (!consented || !videoRef.current) return;
    setBusy(true);
    setError('');
    setNotice('');
    let frame: string | null = null;
    try {
      frame = captureFrame(videoRef.current);
      const status = await attendanceApi.enroll({ consent: true, consentVersion: CONSENT_VERSION, captures: [frame] });
      setTemplate(status);
      setNotice('人脸特征已加密保存。录入照片仅存于私有存储，并将在 30 天后自动清除。');
      stopCamera();
    } catch (reason) {
      setError(readableError(reason)); stopCamera();
    } finally {
      frame = null;
      setBusy(false);
    }
  };

  const deleteTemplate = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await attendanceApi.deleteTemplate();
      setTemplate({ enrolled: false, enrolledAt: null, modelVersion: null, consentVersion: null, enrollmentPhotoExpiresAt: null });
      setConfirmDelete(false);
      setNotice('人脸特征与关联私有照片已删除，后续登录不会再使用旧模板。');
      stopCamera();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  const canEnroll = consented && cameraMode === 'enroll' && !busy;
  const settingsHref = audience === 'teacher' ? '/teacher/attendance' : '/attendance';
  const backHref = audience === 'teacher' ? '/teacher' : '/dashboard';
  const backLabel = audience === 'teacher' ? '返回教学总览' : '返回我的学习';
  const fallbackHref = audience === 'teacher' ? '/teacher' : '/study-plans';
  const fallbackLabel = audience === 'teacher' ? '返回教学总览 →' : '返回学习计划 →';

  return <>
    <div className="space-y-6">
      <section className="dashboard-hero !bg-[#e8f8f2]"><div className="dashboard-hero-copy"><span className="hero-label">LOGIN & DAILY CHECK-IN</span><h1 className="hero-title">让登录，<em>成为学习的起点。</em></h1><p className="hero-copy">教师和学生可选人脸登录，成功后自动记录本人今日打卡；管理员使用密码登录。每天只记一次。</p><Link href={backHref} className="mt-4 inline-flex min-h-11 items-center font-medium text-brand-ink">← {backLabel}</Link></div></section>
      <DailyCheckInCard settingsHref={settingsHref} showPlansLink={audience === 'student'} />
      {notice ? <p role="status" className="rounded-md bg-teal-soft px-4 py-3 text-sm text-teal">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-md bg-rose-soft px-4 py-3 text-sm text-rose">{error}</p> : null}

      <details className="dashboard-section" onToggle={(event) => { if (!event.currentTarget.open) stopCamera(); }}>
        <summary className="min-h-11 cursor-pointer py-3 font-semibold text-text">可选：人脸登录与模板管理</summary>
        <p className="mb-5 text-sm text-textSub">仅在独立授权后启用。展开此区域不会开启摄像头；录入照片加密保留最多 30 天，验证画面不保存。</p>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-glass-line bg-surface p-6 shadow-glass">
          <span className="section-kicker">YOUR CONSENT</span><h2 className="section-title mt-2">人脸信息与授权</h2>
          <p className="section-description mt-2">仅用于本人登录验证与自动打卡。特征向量以独立密钥加密保存；录入照片在私有对象存储中加密，最长保留 30 天后自动清除。</p>
          <div className="mt-5 grid gap-3 rounded-md border border-glass-line bg-bg p-4 text-sm text-textSub"><p><b className="text-text">当前模板：</b>{template?.enrolled ? `已录入 · ${formatDate(template.enrolledAt)}` : '尚未录入'}</p><p><b className="text-text">模型版本：</b>{template?.modelVersion ?? '—'}</p><p><b className="text-text">录入照片期限：</b>{template?.enrollmentPhotoExpiresAt ? formatDate(template.enrollmentPhotoExpiresAt) : '无可用照片'}</p></div>
          {template?.enrolled && template.consentVersion !== CONSENT_VERSION ? <p className="mt-4 text-sm text-amber">旧模板仅获签到授权，需要重新同意并录入才能用于登录。</p> : null}
          <label className="mt-5 flex cursor-pointer gap-3 rounded-md border border-dashed border-brand/40 bg-brand-soft p-4 text-sm text-textSub"><input checked={consented} onChange={(event) => { setConsented(event.target.checked); if (!event.target.checked) stopCamera(); }} type="checkbox" className="mt-1 h-4 w-4 accent-brand" /><span><b className="text-text">我同意独立的人脸信息处理授权</b><br />用于本人登录与自动打卡；特征加密保存，一张录入照片加密保留最多30天，可随时删除；可一直使用密码登录。</span></label>
          {template?.enrolled ? <div className="mt-5"><button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className="rounded-md border border-rose px-4 py-2.5 text-sm font-medium text-rose disabled:opacity-50">删除我的人脸模板</button>{confirmDelete ? <div className="mt-3 rounded-md border border-rose/30 bg-rose-soft p-4"><p className="text-sm text-text">确认删除后，人脸登录将立刻失效；此操作不能恢复。</p><div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={() => void deleteTemplate()} className="rounded-md bg-rose px-4 py-2 text-sm font-medium text-white">确认删除</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className="rounded-md border border-glass-line px-4 py-2 text-sm text-textSub">取消</button></div></div> : null}</div> : null}
        </section>

        <section className="rounded-lg border border-glass-line bg-surface p-6 shadow-glass">
          <span className="section-kicker">CAMERA · LIVE ONLY</span><h2 className="section-title mt-2">人脸登录模板录入</h2><p className="section-description mt-2">先由你主动开启摄像头。预览是当前会话的实时画面，离开页面、成功、失败或取消时会关闭。</p>
          <div className="mt-5 overflow-hidden rounded-md border border-glass-line bg-[#202f49]"><video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" aria-label="实时摄像头预览" /><div className="bg-bg px-4 py-3 text-sm text-textSub">{cameraMessage}</div></div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={!consented || busy} onClick={() => void openCamera('enroll')} className="min-h-11 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">开启摄像头录入</button>
            <button type="button" disabled={!canEnroll} onClick={() => void enroll()} className="min-h-11 rounded-md border border-brand px-4 py-2.5 text-sm font-medium text-brand-ink disabled:opacity-50">{busy ? '正在加密录入…' : '录入并加密保存'}</button>
            {cameraMode ? <button type="button" onClick={stopCamera} className="rounded-md border border-glass-line px-4 py-2.5 text-sm text-textSub">关闭预览</button> : null}
          </div>
          <div className="mt-5 rounded-md bg-amber-soft p-4 text-sm text-textSub"><b className="text-text">不想使用摄像头？</b> 人脸服务未接入、失败或你拒绝授权时，仍可用密码登录；今日打卡也可手动完成。<div className="mt-3"><Link href={fallbackHref} className="inline-flex min-h-11 items-center font-medium text-brand-ink hover:underline">{fallbackLabel}</Link></div></div>
        </section>
      </div>
      </details>
    </div>
  </>;
}
