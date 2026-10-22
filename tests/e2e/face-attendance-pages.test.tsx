import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/services/api';

type TestLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };

const mocks = vi.hoisted(() => ({
  templateStatus: vi.fn(),
  enroll: vi.fn(),
  deleteTemplate: vi.fn(),
  issueChallenge: vi.fn(),
  verify: vi.fn(),
  requestManualConfirmation: vi.fn(),
  today: vi.fn(),
  checkIn: vi.fn(),
  list: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: function TestLink({ children, ...props }: TestLinkProps): ReturnType<typeof createElement> {
    return createElement('a', props, children);
  },
}));

vi.mock('@/components/app/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }): ReturnType<typeof createElement> => createElement('main', null, children),
}));

vi.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: ReactNode }): ReturnType<typeof createElement> => createElement('main', null, children),
}));
vi.mock('@/services/attendance', () => ({ attendanceApi: mocks }));

import AdminAttendancePage from '@/app/admin/attendance/page';
import AttendancePage from '@/app/attendance/page';

const notEnrolled = { enrolled: false, enrolledAt: null, modelVersion: null, consentVersion: null, enrollmentPhotoExpiresAt: null };

describe('face attendance pages', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.templateStatus.mockResolvedValue(notEnrolled);
    mocks.today.mockResolvedValue({ date: '2026-10-09', checkedIn: false, method: null, signedAt: null });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('permission denied')) } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('requires independent consent before enrollment and keeps camera denial from blocking learning', async () => {
    render(createElement(AttendancePage));
    fireEvent.click(screen.getByText('可选：人脸登录与模板管理'));
    expect(await screen.findByText('人脸信息与授权')).toBeTruthy();
    expect((screen.getByRole('button', { name: '开启摄像头录入' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '开启摄像头录入' }));
    expect(await screen.findByText(/摄像头权限未开启或设备不可用/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /查看学习待办/ }).getAttribute('href')).toBe('/study-plans');
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('attaches a granted camera stream to the live preview', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });

    render(createElement(AttendancePage));
    fireEvent.click(screen.getByText('可选：人脸登录与模板管理'));
    await screen.findByText('人脸信息与授权');
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect((screen.getByRole('button', { name: '开启摄像头录入' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '开启摄像头录入' }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(play).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('实时摄像头预览') as HTMLVideoElement).srcObject).toBe(stream);
    expect(await screen.findByText(/画面仅用于本次录入/)).toBeTruthy();
    const details = document.querySelector('details');
    if (!details) throw new Error('Missing optional face panel');
    await act(async (): Promise<void> => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect((screen.getByLabelText('实时摄像头预览') as HTMLVideoElement).srcObject).toBe(null);
  });

  it('completes ordinary daily check-in without biometrics or approval', async () => {
    mocks.checkIn.mockResolvedValue({ date: '2026-10-09', checkedIn: true, method: 'manual', signedAt: '2026-10-09T08:00:00.000Z' });
    render(createElement(AttendancePage));
    await screen.findByText('人脸信息与授权');
    fireEvent.click(screen.getByRole('button', { name: '立即打卡' }));
    await waitFor(() => expect(mocks.checkIn).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('status')).textContent).toContain('普通打卡');
    expect((screen.getByRole('button', { name: '今日已打卡' }) as HTMLButtonElement).disabled).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('deletes an enrolled template only after a second confirmation', async () => {
    mocks.templateStatus.mockResolvedValue({ enrolled: true, enrolledAt: '2026-09-24T08:00:00.000Z', modelVersion: 'licensed-face-v1', consentVersion: 'face-attendance-v1', enrollmentPhotoExpiresAt: '2026-10-24T08:00:00.000Z' });
    mocks.deleteTemplate.mockResolvedValue({ deleted: true });
    render(createElement(AttendancePage));
    fireEvent.click(screen.getByText('可选：人脸登录与模板管理'));
    expect(await screen.findByText('删除我的人脸模板')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除我的人脸模板' }));
    expect(screen.getByText(/确认删除后，人脸登录将立刻失效/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/人脸特征与关联私有照片已删除/)).toBeTruthy();
  });

  it('shows a safe no-permission state on the administrator attendance page', async () => {
    mocks.list.mockRejectedValue(new ApiClientError('禁止访问', 403, 'FORBIDDEN'));
    render(createElement(AdminAttendancePage));
    expect(await screen.findByText('没有管理员权限')).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回工作台' }).getAttribute('href')).toBe('/dashboard');
  });

  it('keeps face controls optional and allows retry after a manual request fails', async () => {
    mocks.checkIn.mockRejectedValueOnce(new Error('服务暂不可用'));
    render(createElement(AttendancePage));
    await screen.findByText('人脸信息与授权');
    expect(document.querySelector('details')?.open).toBe(false);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '立即打卡' }));
    expect((await screen.findByRole('alert')).textContent).toBe('服务暂不可用');
    expect(screen.getByText(/今日尚未打卡/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: '立即打卡' }) as HTMLButtonElement).disabled).toBe(false));
  });
});

