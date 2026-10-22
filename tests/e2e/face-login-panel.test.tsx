import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FaceLoginPanel } from '@/components/auth/FaceLoginPanel';

const mocks = vi.hoisted(() => ({ loginChallenge: vi.fn(), faceLogin: vi.fn() }));
vi.mock('@/services/attendance', () => ({ attendanceApi: mocks }));
const success = vi.fn(); const busy = vi.fn();
const challenge = { challengeId: 'test-only-challenge', action: 'blink', expiresAt: new Date(Date.now() + 120_000).toISOString() };

describe('face login camera lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loginChallenge.mockResolvedValue(challenge);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  function panel(): ReturnType<typeof render> { return render(createElement(FaceLoginPanel, { account: 'test@example.com', remember: false, onSuccess: success, onBusyChange: busy })); }

  it('keeps camera off until requested and unavailable service never requests permission', async () => {
    mocks.loginChallenge.mockRejectedValue(new Error('人脸登录服务尚未接入，请使用密码登录'));
    panel(); expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
    expect((await screen.findByRole('alert')).textContent).toContain('请使用密码登录');
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });

  it('camera permission denial does not log in', async () => {
    const error = new Error('denied'); error.name = 'NotAllowedError';
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(error);
    panel(); fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
    expect((await screen.findByRole('alert')).textContent).toContain('摄像头权限未开启');
    expect(mocks.faceLogin).not.toHaveBeenCalled();
  });

  it('releases a granted stream on cancel and account change', async () => {
    const stop = vi.fn(); const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
    const view = panel(); fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
    await screen.findByRole('button', { name: '准备好了' });
    fireEvent.click(screen.getByRole('button', { name: '取消并关闭摄像头' }));
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
    await screen.findByRole('button', { name: '准备好了' });
    view.rerender(createElement(FaceLoginPanel, { account: 'other@example.com', remember: false, onSuccess: success, onBusyChange: busy }));
    expect(stop).toHaveBeenCalledTimes(2); expect(mocks.faceLogin).not.toHaveBeenCalled();
  });

  it('closes a late permission grant after unmount', async () => {
    const stop = vi.fn(); let grant: ((stream: MediaStream) => void) | undefined;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const view = panel(); fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async (): Promise<void> => { grant?.({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
    expect(stop).toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });

  it('scan automatically submits from one click, releases camera, and has no action buttons', async () => {
    mocks.loginChallenge.mockResolvedValue({ ...challenge, verificationMode: 'scan' });
    const stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    mocks.faceLogin.mockResolvedValue({ accessToken: 'test-token', redirect: '/dashboard' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw0KGgo=');
    panel();
    const video = screen.getByLabelText('人脸登录摄像头预览');
    Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 }, readyState: { value: 2 } });
    vi.useFakeTimers();
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    expect(mocks.faceLogin.mock.calls[0][0].captures).toHaveLength(3);
    expect(success).toHaveBeenCalledWith('test-token', '/dashboard');
    expect(stop).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '准备好了' })).toBeNull();
  });

  it('scan cancellation releases the camera and ignores a late login response', async () => {
    mocks.loginChallenge.mockResolvedValue({ ...challenge, verificationMode: 'scan' });
    const stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    let resolveLogin: ((value: { accessToken: string; redirect: string }) => void) | undefined;
    mocks.faceLogin.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw0KGgo=');
    panel();
    Object.defineProperties(screen.getByLabelText('人脸登录摄像头预览'), { videoWidth: { value: 640 }, videoHeight: { value: 480 }, readyState: { value: 2 } });
    vi.useFakeTimers();
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '取消并关闭摄像头' }));
    expect(mocks.faceLogin.mock.calls[0][1].aborted).toBe(true);
    await act(async (): Promise<void> => { resolveLogin?.({ accessToken: 'late-token', redirect: '/dashboard' }); });
    expect(stop).toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });

  it('sends a bounded sequence of motion frames and releases camera on rejection', async () => {
    const stop = vi.fn(); const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
    mocks.faceLogin.mockRejectedValue(new Error('人脸登录未通过'));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw0KGgo=');
    panel(); fireEvent.click(screen.getByRole('button', { name: '扫描人脸并登录' }));
    await screen.findByRole('button', { name: '准备好了' });
    const video = screen.getByLabelText('人脸登录摄像头预览');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    fireEvent.click(screen.getByRole('button', { name: '准备好了' }));
    vi.useFakeTimers();
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: '开始动作并验证登录' }));
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole('status').textContent).toContain('请睁眼并回正');
    expect(mocks.faceLogin).not.toHaveBeenCalled();
    await act(async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    vi.useRealTimers();
    expect(mocks.faceLogin).toHaveBeenCalledWith(expect.objectContaining({ account: 'test@example.com', captures: expect.any(Array) }), expect.anything());
    expect(mocks.faceLogin.mock.calls[0][0].captures).toHaveLength(12);
    expect((await screen.findByRole('alert')).textContent).toBe('人脸登录未通过');
    expect(stop).toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });
});
