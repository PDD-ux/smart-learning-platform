import { apiRequest } from '@/services/api';

export type FaceTemplateStatus = {
  enrolled: boolean;
  enrolledAt: string | null;
  modelVersion: string | null;
  consentVersion: string | null;
  enrollmentPhotoExpiresAt: string | null;
};

export type LivenessAction = 'blink' | 'turn_left' | 'turn_right';

export type LivenessChallenge = {
  verificationMode?: 'action' | 'scan';
  challengeId: string;
  action: LivenessAction;
  expiresAt: string;
};

export type FaceAttendanceResult = {
  status: 'signed_in' | 'manual_confirmation_required';
  signedAt: string | null;
  reason?: 'FACE_NOT_ENROLLED' | 'VERIFICATION_FAILED' | 'COOLDOWN';
};

export type AttendanceRecord = {
  id: string;
  userId: string;
  nickname: string;
  status: 'signed_in' | 'self_check_in' | 'manual_confirmation';
  verificationVersion: string;
  signedAt: string;
};

export type AttendanceRecordList = {
  page: number;
  pageSize: number;
  total: number;
  items: AttendanceRecord[];
};

export type AttendanceQuery = {
  page?: number;
  pageSize?: number;
  userId?: string;
  status?: AttendanceRecord['status'];
  from?: string;
  to?: string;
};

function toSearchParams(params: AttendanceQuery): string {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.userId) search.set('userId', params.userId);
  if (params.status) search.set('status', params.status);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  return search.toString();
}

/** 人脸签到 API 的唯一前端入口；页面不直接访问 fetch。 */
export type DailyCheckIn = { date: string; checkedIn: boolean; method: 'manual' | 'face' | null; signedAt: string | null };

export const attendanceApi = {
  today: (): Promise<DailyCheckIn> => apiRequest<DailyCheckIn>('/api/attendance/today'),
  checkIn: (): Promise<DailyCheckIn> => apiRequest<DailyCheckIn>('/api/attendance/today', { method: 'POST' }),
  loginChallenge: (account: string, signal?: AbortSignal): Promise<LivenessChallenge> => apiRequest<LivenessChallenge>('/api/auth/face/challenge', { method: 'POST', body: { account }, signal }),
  faceLogin: (body: { account: string; challengeId: string; captures: string[]; remember: boolean }, signal?: AbortSignal): Promise<{ accessToken: string; redirect: string; checkIn: DailyCheckIn }> =>
    apiRequest('/api/auth/face/login', { method: 'POST', body, signal }),
  templateStatus: (): Promise<FaceTemplateStatus> => apiRequest<FaceTemplateStatus>('/api/face/template'),
  enroll: (body: { consent: true; consentVersion: string; captures: string[] }): Promise<FaceTemplateStatus> =>
    apiRequest<FaceTemplateStatus>('/api/face/enroll', { method: 'POST', body }),
  deleteTemplate: (): Promise<{ deleted: boolean }> => apiRequest<{ deleted: boolean }>('/api/face/template', { method: 'DELETE' }),
  issueChallenge: (): Promise<LivenessChallenge> => apiRequest<LivenessChallenge>('/api/attendance/challenge', { method: 'POST' }),
  verify: (body: { challengeId: string; captures: string[] }): Promise<FaceAttendanceResult> =>
    apiRequest<FaceAttendanceResult>('/api/attendance/verify', { method: 'POST', body }),
  requestManualConfirmation: (): Promise<FaceAttendanceResult> =>
    apiRequest<FaceAttendanceResult>('/api/attendance/manual', { method: 'POST' }),
  list: (params: AttendanceQuery = {}): Promise<AttendanceRecordList> => {
    const query = toSearchParams(params);
    return apiRequest<AttendanceRecordList>(`/api/admin/attendance${query ? `?${query}` : ''}`);
  },
};
