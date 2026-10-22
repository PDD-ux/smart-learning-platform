'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { attendanceApi, type LivenessChallenge } from '@/services/attendance';

type Props = { account: string; remember: boolean; onSuccess: (token: string, redirect: string) => void; onBusyChange: (busy: boolean) => void };
const actions = { blink: '闭眼约一秒，再睁眼正视镜头', turn_left: '缓慢向自己的左侧转头，再回正', turn_right: '缓慢向自己的右侧转头，再回正' };

function capture(video: HTMLVideoElement): string {
  if (video.videoWidth < 80 || video.videoHeight < 80) throw new Error('画面尚未准备好，请稍后重试');
  const scale = Math.min(640 / video.videoWidth, 480 / video.videoHeight);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持画面采集');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL('image/jpeg', 0.85); canvas.width = 0; canvas.height = 0;
  return image;
}

export function FaceLoginPanel({ account, remember, onSuccess, onBusyChange }: Props): ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const frames = useRef<string[]>([]);
  const pending = useRef<AbortController | null>(null);
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [mode, setMode] = useState<'action' | 'scan'>('scan');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'camera' | 'action'>('camera');
  const stop = useCallback((): void => {
    generation.current += 1;
    pending.current?.abort(); pending.current = null;
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    frames.current = [];
    if (video.current) video.current.srcObject = null;
    if (alive.current) { setBusy(false); setReady(false); setChallenge(null); setStep('camera'); setCaptureSeconds(0); onBusyChange(false); }
  }, [onBusyChange]);
  useEffect(() => { alive.current = true; return (): void => { alive.current = false; stop(); }; }, [stop]);
  useEffect(() => { stop(); setError(''); }, [account, stop]);
  const start = async (): Promise<void> => {
    stop(); const attempt = generation.current;
    const requestController = new AbortController(); pending.current = requestController;
    setBusy(true); onBusyChange(true); setError('');
    let nextStream: MediaStream | null = null;
    try {
      const next = await attendanceApi.loginChallenge(account, requestController.signal);
      if (!alive.current || attempt !== generation.current) return;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头，请使用密码登录');
      nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!alive.current || attempt !== generation.current) { nextStream.getTracks().forEach((track) => track.stop()); return; }
      stream.current = nextStream;
      if (!video.current) throw new Error('预览尚未准备好');
      video.current.srcObject = nextStream; await video.current.play();
      if (!alive.current || attempt !== generation.current) return;
      setChallenge(next); setReady(true); setMode(next.verificationMode ?? 'action');
      if (next.verificationMode === 'scan') {
        // A single user click: wait for usable video, sample briefly, then authenticate.
        for (let wait = 0; wait < 20 && (video.current.videoWidth < 80 || video.current.readyState < 2); wait += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          if (!alive.current || attempt !== generation.current || !video.current) return;
        }
        frames.current = [];
        for (let index = 0; index < 3; index += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 120));
          if (!alive.current || attempt !== generation.current || !video.current) return;
          frames.current.push(capture(video.current));
        }
        const result = await attendanceApi.faceLogin({ account, remember, challengeId: next.challengeId, captures: frames.current }, requestController.signal);
        if (alive.current && attempt === generation.current) onSuccess(result.accessToken, result.redirect);
        stop();
      }
    } catch (reason) {
      nextStream?.getTracks().forEach((track) => track.stop());
      if (alive.current && attempt === generation.current) { setError(reason instanceof Error && reason.name === 'NotAllowedError' ? '摄像头权限未开启，请允许摄像头或使用密码登录' : reason instanceof Error ? reason.message : '人脸登录未完成'); stop(); }
    } finally { if (alive.current && attempt === generation.current) { setBusy(false); if (!stream.current) onBusyChange(false); } }
  };
  const beforeAction = (): void => {
    try { if (!video.current) return; frames.current = [capture(video.current)]; setStep('action'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '采集失败'); stop(); }
  };
  const verify = async (): Promise<void> => {
    if (!challenge || !video.current || frames.current.length !== 1) return;
    setBusy(true); setError('');
    const attempt = generation.current;
    try {
      frames.current = [capture(video.current)];
      // 连续动作画面交给真实服务判断活体，不用一张动作后的照片假装动态核验。
      for (let index = 0; index < 11; index += 1) {
        setCaptureSeconds(Math.ceil((11 - index) * 0.35));
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
        if (!alive.current || attempt !== generation.current || !video.current) return;
        frames.current.push(capture(video.current));
      }
      setCaptureSeconds(0);
      const result = await attendanceApi.faceLogin({ account, remember, challengeId: challenge.challengeId, captures: frames.current }, pending.current?.signal);
      if (alive.current && attempt === generation.current) onSuccess(result.accessToken, result.redirect);
    } catch (reason) { if (alive.current && attempt === generation.current) setError(reason instanceof Error ? reason.message : '人脸登录未通过，请使用密码登录'); }
    finally { if (attempt === generation.current) stop(); }
  };
  return <div className="space-y-3">
    <p className="text-sm leading-6 text-textSub">先用密码登录，在我的学习授权录入。人脸验证成功后自动打卡；管理员请使用密码登录。</p>
    {mode === 'scan' ? <p className="text-xs leading-5 text-textSub">正视摄像头，点击一次即可扫描登录。便捷扫描仅比对人脸，不做活体核验，照片可能冒用；适用于本地毕设演示。</p> : null}
    <video ref={video} autoPlay muted playsInline aria-label="人脸登录摄像头预览" className={ready ? 'aspect-video w-full rounded-md bg-bg object-cover' : 'hidden'} />
    {error ? <p role="alert" className="auth-error">{error}</p> : null}
    {ready ? <><p role="status" className="text-sm text-brand-ink">{mode === 'scan' ? '正在扫描，请正视镜头，匹配成功后自动登录' : step === 'camera' ? '先正视镜头，点击准备好了' : busy ? captureSeconds > 0 ? `采集剩余 ${captureSeconds} 秒：${captureSeconds <= 2 ? '请睁眼并回正，保持正视镜头' : actions[challenge?.action ?? 'blink']}` : '采集结束，正在核验，请稍候' : `保持正视，点击下方按钮后，在前两秒${actions[challenge?.action ?? 'blink']}，后两秒保持正视`}。验证画面不保存。</p>
      {mode === 'action' ? step === 'camera' ? <button type="button" onClick={beforeAction} className="auth-primary-button">准备好了</button> : <button type="button" disabled={busy} onClick={() => void verify()} className="auth-primary-button">{busy ? '采集动作并验证中…' : '开始动作并验证登录'}</button> : null}
      <button type="button" disabled={busy && mode === 'action'} onClick={stop} className="min-h-11 text-sm text-textSub">取消并关闭摄像头</button></> : <button type="button" disabled={busy || !account.trim()} onClick={() => void start()} className="auth-primary-button">{busy ? '正在扫描…' : '扫描人脸并登录'}</button>}
  </div>;
}
