import { notifyProfileUpdated } from './profile-updates';
import { PAGE_SIZES, TIMEOUTS } from '@/lib/config';
import type { AdminThreadDto, AdminReplyDto, ReportDto, ModerationList } from '@/lib/discussions/moderation-contracts';
export type { AdminThreadDto, AdminReplyDto, ReportDto, ModerationList } from '@/lib/discussions/moderation-contracts';
import type { DiscussionList, DiscussionThreadDto, DiscussionReplyDto } from '@/lib/discussions/contracts';
import type { ContentRef } from '@/lib/domain/content-ref';
export type { DiscussionList, DiscussionThreadDto, DiscussionReplyDto } from '@/lib/discussions/contracts';
import type { AdminCourse, AdminCourseSummary, CourseDetail, CourseList, PrepareCourse } from '@/lib/courses/contracts';
export type { AdminCourse, AdminCourseSummary, CourseDetail, CourseSummary, CourseList, PrepareCourse } from '@/lib/courses/contracts';
import type { AgentRequest, AgentResult } from '@/lib/agent/contracts';
export type { AgentRequest, AgentResult } from '@/lib/agent/contracts';

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: string;
  timestamp: string;
};

export type ApiFailure = {
  success: false;
  error: { code: string; message: string; details?: unknown };
  timestamp: string;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly retryAfter: number | null;

  constructor(message: string, status: number, code: string, details?: unknown, retryAfter?: number | null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter ?? null;
  }
}

const TOKEN_KEY = 'smart-learning-access-token';
let sessionGeneration = 0;
let signedOut = false;
let watchingStorage = false;
let renewal: { generation: number; promise: Promise<void> } | null = null;

function watchSessionStorage(): void {
  if (typeof window === 'undefined' || watchingStorage) return;
  watchingStorage = true;
  window.addEventListener('storage', (event: StorageEvent): void => {
    if (event.key === TOKEN_KEY || event.key === null) { sessionGeneration++; signedOut = !window.localStorage.getItem(TOKEN_KEY); }
  });
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  watchSessionStorage();
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  sessionGeneration++; signedOut = false;
  if (typeof window !== 'undefined') window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  sessionGeneration++; signedOut = true;
  if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
}

type RequestOptions = {
  responseKind?: 'blob';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

function isApiFailure(value: unknown): value is ApiFailure {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { success?: unknown; error?: unknown };
  return candidate.success === false && typeof candidate.error === 'object' && candidate.error !== null;
}

function tokenInfo(token: string | null): { sub: string; exp: number } | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!part) return null;
    const value: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as { sub?: unknown; exp?: unknown };
    return typeof candidate.sub === 'string' && typeof candidate.exp === 'number' && Number.isFinite(candidate.exp) ? { sub: candidate.sub, exp: candidate.exp } : null;
  } catch { return null; }
}

function sessionChanged(): ApiClientError {
  return new ApiClientError('登录状态已变化，请在当前账号下重新操作。', 409, 'SESSION_CHANGED');
}

function endSession(): void {
  clearAccessToken();
  // A full reload clears the expired account's page state; this service has no React router.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.assign('/login');
}

function responseError(response: Response, payload: unknown): ApiClientError {
  const failure = isApiFailure(payload) ? payload.error : undefined;
  const retryAfterValue = response.headers.get('Retry-After');
  const retryAfter = retryAfterValue ? Number(retryAfterValue) : null;
  return new ApiClientError(failure?.message ?? `请求失败（${response.status}）`, response.status, failure?.code ?? 'HTTP_ERROR', failure?.details, Number.isFinite(retryAfter) ? retryAfter : null);
}

/** 单页共享续期；响应仅更新访问令牌，不重新载入当前页面。 */
function renewSession(): Promise<void> {
  if (signedOut) return Promise.reject(sessionChanged());
  if (renewal?.generation === sessionGeneration) return renewal.promise;
  const generation = sessionGeneration;
  const previous = getAccessToken();
  const previousSubject = tokenInfo(previous)?.sub;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.SESSION_REFRESH_MS);
  const promise = (async (): Promise<void> => {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-Session-Refresh': '1' }, signal: controller.signal });
      const payload: unknown = await response.json().catch(() => null);
      if (generation !== sessionGeneration || previous !== getAccessToken()) throw sessionChanged();
      if (!response.ok || isApiFailure(payload)) {
        if (response.status === 401 && isApiFailure(payload) && payload.error.code === 'UNAUTHENTICATED') endSession();
        throw responseError(response, payload);
      }
      const data = typeof payload === 'object' && payload !== null && (payload as { success?: unknown }).success === true ? (payload as { data?: unknown }).data : null;
      const result = data as { accessToken?: unknown; user?: { id?: unknown }; expiresInSec?: unknown } | null;
      const info = typeof result?.accessToken === 'string' ? tokenInfo(result.accessToken) : null;
      if (!info || info.sub !== result?.user?.id || typeof result?.expiresInSec !== 'number' || result.expiresInSec <= 0 || info.exp * 1_000 <= Date.now()) throw new ApiClientError('登录续期返回格式异常，请重试。', 503, 'SESSION_REFRESH_UNAVAILABLE');
      if (previousSubject && previousSubject !== info.sub) throw sessionChanged();
      if (typeof window !== 'undefined') window.localStorage.setItem(TOKEN_KEY, result!.accessToken as string);
    } catch (reason: unknown) {
      if (reason instanceof ApiClientError) throw reason;
      throw new ApiClientError('登录续期暂不可用，当前输入已保留，请稍后重试。', 503, 'SESSION_REFRESH_UNAVAILABLE');
    } finally { clearTimeout(timer); if (renewal?.generation === generation) renewal = null; }
  })();
  renewal = { generation, promise };
  return promise;
}

async function awaitRenewal(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  const promise = renewSession();
  if (!signal) return promise;
  return new Promise<void>((resolve, reject): void => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(new DOMException('请求已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isAuth = path.startsWith('/api/auth/');
  const isLogout = path === '/api/auth/logout';
  if (isLogout) clearAccessToken();
  const generation = sessionGeneration;
  const info = tokenInfo(getAccessToken());
  if (!isAuth && info && info.exp * 1_000 <= Date.now() + 30_000) await awaitRenewal(options.signal);
  if (!isAuth && generation !== sessionGeneration) throw sessionChanged();
  if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  const headers = new Headers(options.headers);
  if (isLogout) headers.set('X-Session-Refresh', '1');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined && !(options.body instanceof FormData) && !(options.body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
  }

  const request = (): Promise<Response> => fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined
      ? undefined
      : (options.body instanceof FormData || options.body instanceof Blob)
        ? options.body
        : JSON.stringify(options.body),
    signal: options.signal,
  }).catch((error: unknown): never => {
    if (error instanceof TypeError) throw new ApiClientError('无法连接网站服务，请确认网页服务已启动，再手动重试。', 0, 'NETWORK_UNAVAILABLE');
    throw error;
  });
  let response = await request();
  const readPayload = (value: Response): Promise<unknown> => options.responseKind === 'blob' && value.ok ? value.blob() : value.json().catch(() => null);
  let payload: unknown = await readPayload(response);
  if (!isAuth && generation !== sessionGeneration) throw sessionChanged();

  if (!isAuth && response.status === 401 && isApiFailure(payload) && payload.error.code === 'UNAUTHENTICATED') {
    if (signedOut) throw sessionChanged();
    if (token === getAccessToken()) await awaitRenewal(options.signal);
    if (generation !== sessionGeneration) throw sessionChanged();
    if ((options.method ?? 'GET') !== 'GET') throw new ApiClientError('登录已续期，请先核对操作状态，再手动重试。', 409, 'SESSION_RENEWED_RETRY');
    if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    const renewedToken = getAccessToken();
    if (!renewedToken) throw sessionChanged();
    headers.set('Authorization', `Bearer ${renewedToken}`);
    response = await request();
    payload = await readPayload(response);
    if (generation !== sessionGeneration) throw sessionChanged();
    if (response.status === 401 && isApiFailure(payload) && payload.error.code === 'UNAUTHENTICATED') endSession();
  }

  if (!response.ok || isApiFailure(payload)) {
    throw responseError(response, payload);
  }

  if (options.responseKind === 'blob') { if (!(payload instanceof Blob)) throw new ApiClientError('下载返回格式异常', response.status, 'INVALID_RESPONSE'); return payload as T; }
  if (typeof payload !== 'object' || payload === null || (payload as { success?: unknown }).success !== true) {
    throw new ApiClientError('服务返回格式异常', response.status, 'INVALID_RESPONSE');
  }
  return (payload as ApiSuccess<T>).data;
}

export type ContentSummary = {
  /** EPUB has stable paragraph positions, not fixed pages. */
  format?: 'EPUB';
  contentId: string;
  contentType: 'video' | 'document';
  title: string;
  description: string | null;
  durationSec: number | null;
  pageCount: number | null;
  status: '待导入' | '上传中' | '解析中' | '已就绪' | '失败';
  coverUrl: string | null;
  understandingStatus: 'none' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
};

export type ContentList = { page: number; pageSize: number; total: number; items: ContentSummary[] };
export type Flashcard = {
  flashcardId: string;
  contentId: string;
  pointId: string | null;
  contentTitle?: string | null;
  pointTitle?: string | null;
  cardType: string;
  front: string;
  back: string;
  hint: string | null;
  status: string;
  nextReviewAt: string;
  easeFactor: number;
  intervalDays: number;
};
export type WeakPoint = {
  pointId: string;
  title: string;
  tags: string[];
  score: number;
  contentId: string;
  contentTitle: string;
  relatedFlashcardCount: number;
  lastReviewAt: string | null;
};
export type MasteryItem = { pointId: string; title: string; score: number; isWeak: boolean; reviewCount: number; correctRate: number | null };
export type GraphNode = {
  pointId: string;
  title: string;
  nodeType: 'concept' | 'formula' | 'method' | 'theorem';
  mastery: number;
  isWeak: boolean;
  reviewCount: number;
  correctRate: number | null;
  relatedNoteCount: number;
  relatedFlashcardCount: number;
  lastReviewedAt: string | null;
};
export type GraphEdge = { source: string; target: string; relation: 'prerequisite' | 'related' | 'example_of'; weight: number };
export type ContentGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type GraphOverviewNode = GraphNode & {
  pointIds: string[];
  contentIds: string[];
  aliases: string[];
  weakPointCount: number;
};
export type GraphOverviewEdge = GraphEdge & { contentIds: string[] };
export type GraphOverview = {
  nodes: GraphOverviewNode[];
  edges: GraphOverviewEdge[];
  summary: { contentCount: number; nodeCount: number; weakPointCount: number; edgeCount: number };
};
export type Profile = {
  nickname: string;
  role: 'admin' | 'teacher' | 'student';
  xpTotal: number;
  currentLevel: string;
  achievements: Array<{ key: string; title: string; unlocked: boolean; unlockedAt: string | null }>;
};
export type AdminUser = {
  id: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  role: 'admin' | 'teacher' | 'student';
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
};
export type AdminUserList = { page: number; pageSize: number; total: number; items: AdminUser[] };
export type AdminOverview = {
  date: string;
  generatedAt: string;
  users: {
    total: number;
    students: number;
    admins: number;
    teachers: number;
    recent: Array<Pick<AdminUser, 'id' | 'nickname' | 'role' | 'createdAt'>>;
  };
  attendance: { total: number; signedIn: number; selfCheckIn: number; manualConfirmation: number };
};
export type NoteItem = {
  noteId: string;
  contentId: string;
  content: string;
  ref: { type: 'video'; timestampSec: number } | { type: 'document'; page: number; blockIndex?: number };
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type SearchHit = { noteId: string; content: string; ref: NoteItem['ref']; contentId: string; contentTitle: string };
export type PersonalNote = NoteItem & { contentTitle: string };
export type PersonalNoteList = { page: number; pageSize: number; total: number; items: PersonalNote[] };
export type NoteSearchResult = { page: number; pageSize: number; total: number; items: SearchHit[] };
export type NoteExportResult = { downloadUrl: string; expiresInSec: number; fileName: string };
export type Understanding = {
  contentId: string;
  transcriptSegments: Array<{ segmentId: string; seq: number; startMs: number; endMs: number; text: string }>;
  textBlocks: Array<{ blockId: string; ref: NoteItem['ref']; text: string; source: string }>;
  knowledgePoints: Array<{ pointId: string; title: string; summary: string; tags: string[]; importance: number; refs: NoteItem['ref'][] }>;
  status: string;
  degradation?: string;
};
export type Resource = { pasteSource?: import('@/lib/text-imports/contracts').PasteSource; source?: import('@/lib/url-imports/contracts').UrlSource; contentId: string; contentType: 'video' | 'document'; url: string; expiresInSec: number; durationSec: number | null; pageCount: number | null; format: string };
export type UploadIntent = { contentId: string; uploadUrl: string; expiresInSec: number };
export type Progress =
  | { contentType: 'video'; positionSec: number; lastStudiedAt: string | null }
  | { contentType: 'document'; page: number; scrollRatio: number; lastStudiedAt: string | null };
export type ReviewResult = { nextReviewAt: string; xpGain: number; newStreak: number; newXpTotal: number; levelUp: { from: string; to: string } | null; unlockedAchievements: Array<{ key: string; title: string }> };
export type Exercise = { exerciseId: string; pointId: string; type: 'single_choice' | 'true_false' | 'short_answer'; question: string; options: string[]; index: number };
export type StudyPlan = { planId: string; contentId: string; contentTitle: string; title: string; targetMinutes: number; scheduledAt: string; remindAt: string; completedAt: string | null; isDue: boolean };
export type PlanList = { items: StudyPlan[]; total: number; page: number; pageSize: number; summary: { totalPlans: number; completedPlans: number } };
export type BankQuestion = Exercise & { contentId: string; contentTitle: string; pointTitle: string; latestRecord: { userAnswer: string; correct: boolean; createdAt: string; correctAnswer: string; explanation: string } | null };
export type BankList = { items: BankQuestion[]; total: number; page: number; pageSize: number };
export type QaResult = { qaId: string; answer: string; citations: Array<{ ref: NoteItem['ref']; excerpt: string }>; createdAt: string };
export type SummaryResult = { summaryId: string; summary: string; basedOn: unknown; generatedAt: string };
export type GeneratedNote = { markdown: string; sourceCount: number; generatedAt: string };

export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  }).catch((error: unknown): never => {
    if (error instanceof TypeError) throw new ApiClientError('文件尚未上传成功：无法连接上传服务，请确认网站服务和上传地址可用，再手动重试。', 0, 'UPLOAD_NETWORK_UNAVAILABLE');
    throw error;
  });
  if (!response.ok) {
    throw new ApiClientError('文件上传失败', response.status, 'UPLOAD_FAILED');
  }
}

async function collectPages<T>(path: string, identify: (item: T) => string): Promise<{ page: number; pageSize: number; total: number; items: T[] }> {
  const items = new Map<string, T>();
  let page = 1;
  let total = 0;
  for (;;) {
    const result = await apiRequest<{ total: number; items: T[] }>(`${path}&page=${page}`);
    total = result.total;
    const previousSize = items.size;
    result.items.forEach((item) => items.set(identify(item), item));
    if (page * 50 >= total) break;
    if (items.size === previousSize) throw new ApiClientError('列表已变化，请刷新重试', 409, 'LIST_CHANGED');
    page += 1;
  }
  // 全量预加载：把所有分页结果合并为一份完整集合返回给调用方（contents / flashcards 等
  // 需要一次性拿到全部条目）。元数据如实反映“整份集合作为单页”，避免 pageSize:50 这类
  // 与真实返回量不符的谎言误导消费者。
  const collected = [...items.values()];
  return { page: 1, pageSize: collected.length, total, items: collected };
}

export const api = {
  messages: (page = 1): Promise<import('@/lib/discussions/notifications').MessageList> => apiRequest(`/api/notifications?page=${page}`),
  readMessage: (id: string): Promise<{ id: string; readAt: string }> => apiRequest(`/api/notifications/${encodeURIComponent(id)}`, { method: 'PATCH', body: { read: true } }),
  readAllMessages: (before: string): Promise<{ updated: number }> => apiRequest('/api/notifications/read-all', { method: 'POST', body: { before } }),
  participatedDiscussions: (page = 1): Promise<import('@/lib/discussions/notifications').ParticipationList> => apiRequest(`/api/discussions/participated?page=${page}`),
  adminDiscussions: (page = 1, courseId = '', visibility = 'all'): Promise<ModerationList<AdminThreadDto>> => apiRequest(`/api/admin/discussions?page=${page}&visibility=${encodeURIComponent(visibility)}${courseId ? `&courseId=${encodeURIComponent(courseId)}` : ''}`),
  adminDiscussion: (id: string): Promise<AdminThreadDto> => apiRequest(`/api/admin/discussions/${encodeURIComponent(id)}`),
  adminDiscussionReplies: (id: string, page = 1, replyId = ''): Promise<ModerationList<AdminReplyDto>> => apiRequest(`/api/admin/discussions/${encodeURIComponent(id)}/replies?page=${page}${replyId ? `&replyId=${encodeURIComponent(replyId)}` : ''}`),
  moderateDiscussion: (id: string, expectedVersion: number, action: 'hide'|'restore'|'pin'|'unpin', reason: string): Promise<AdminThreadDto> => apiRequest(`/api/admin/discussions/${encodeURIComponent(id)}`, {method:'PATCH',body:{expectedVersion,action,reason}}),
  moderateReply: (id: string, expectedVersion: number, action: 'hide'|'restore', reason: string): Promise<DiscussionReplyDto> => apiRequest(`/api/admin/discussion-replies/${encodeURIComponent(id)}`, {method:'PATCH',body:{expectedVersion,action,reason}}),
  setCourseDiscussion: (id: string, expectedVersion: number, enabled: boolean, reason: string): Promise<{courseId:string;version:number;discussionEnabled:boolean}> => apiRequest(`/api/admin/courses/${encodeURIComponent(id)}/discussion`, {method:'PATCH',body:{expectedVersion,enabled,reason}}),
  reportDiscussion: (id: string, reason: string, requestId: string, replyId?: string): Promise<ReportDto> => apiRequest(`/api/discussions/${encodeURIComponent(id)}/reports`, {method:'POST',body:{reason,requestId,...(replyId?{replyId}:{})}}),
  myDiscussionReports: (page = 1): Promise<ModerationList<ReportDto>> => apiRequest(`/api/discussion-reports?mine=true&page=${page}`),
  adminDiscussionReports: (page = 1, courseId = '', state = 'all'): Promise<ModerationList<ReportDto>> => apiRequest(`/api/admin/discussion-reports?page=${page}&state=${encodeURIComponent(state)}${courseId ? `&courseId=${encodeURIComponent(courseId)}` : ''}`),
  handleDiscussionReport: (id: string, expectedVersion: number, resolution: string): Promise<ReportDto> => apiRequest(`/api/admin/discussion-reports/${encodeURIComponent(id)}`, {method:'PATCH',body:{expectedVersion,resolution}}),
  discussions: (courseId: string, page = 1, mine = false, sort: 'newest' | 'oldest' = 'newest'): Promise<DiscussionList<DiscussionThreadDto>> => apiRequest(`/api/courses/${encodeURIComponent(courseId)}/discussions?page=${page}&mine=${mine}&sort=${sort}`),
  discussion: (id: string): Promise<DiscussionThreadDto> => apiRequest(`/api/discussions/${encodeURIComponent(id)}`),
  createDiscussion: (courseId: string, body: { kind: 'question' | 'discussion'; title: string; body: string; ref: ContentRef | null; requestId: string }): Promise<DiscussionThreadDto> => apiRequest(`/api/courses/${encodeURIComponent(courseId)}/discussions`, { method: 'POST', body }),
  updateDiscussion: (id: string, body: { expectedVersion: number; title?: string; body?: string; solved?: boolean }): Promise<DiscussionThreadDto> => apiRequest(`/api/discussions/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteDiscussion: (id: string, expectedVersion: number): Promise<{ deleted: boolean }> => apiRequest(`/api/discussions/${encodeURIComponent(id)}`, { method: 'DELETE', body: { expectedVersion } }),
  discussionReplies: (id: string, page = 1): Promise<DiscussionList<DiscussionReplyDto>> => apiRequest(`/api/discussions/${encodeURIComponent(id)}/replies?page=${page}`),
  createDiscussionReply: (id: string, body: string, requestId: string): Promise<DiscussionReplyDto> => apiRequest(`/api/discussions/${encodeURIComponent(id)}/replies`, { method: 'POST', body: { body, requestId } }),
  updateDiscussionReply: (id: string, body: string, expectedVersion: number): Promise<DiscussionReplyDto> => apiRequest(`/api/discussion-replies/${encodeURIComponent(id)}`, { method: 'PATCH', body: { body, expectedVersion } }),
  deleteDiscussionReply: (id: string, expectedVersion: number): Promise<{ deleted: boolean }> => apiRequest(`/api/discussion-replies/${encodeURIComponent(id)}`, { method: 'DELETE', body: { expectedVersion } }),
  courses: (page = 1, q = ''): Promise<CourseList> => apiRequest(`/api/courses?page=${page}&q=${encodeURIComponent(q)}`),
  course: (id: string): Promise<CourseDetail> => apiRequest(`/api/courses/${encodeURIComponent(id)}`),
  adminCourses: (page = 1): Promise<CourseList<AdminCourseSummary>> => apiRequest(`/api/admin/courses?page=${page}`),
  adminCourse: (id: string): Promise<AdminCourse> => apiRequest(`/api/admin/courses/${encodeURIComponent(id)}`),
  prepareCourse: (body: PrepareCourse): Promise<AdminCourse> => apiRequest('/api/admin/courses', { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUTS.COURSE_PREPARE_MS) }),
  changeCourse: (id: string, expectedVersion: number, action: 'publish' | 'withdraw'): Promise<AdminCourse> => apiRequest(`/api/admin/courses/${encodeURIComponent(id)}`, { method: 'PATCH', body: { expectedVersion, action }, signal: AbortSignal.timeout(TIMEOUTS.COURSE_STATE_CHANGE_MS) }),
  agent: (body: AgentRequest): Promise<AgentResult> => apiRequest('/api/assistant/agent', { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUTS.AGENT_REQUEST_MS) }),
  studyPlans: (page = 1, due = false): Promise<PlanList> => apiRequest(`/api/study-plans?pageSize=${PAGE_SIZES.STUDY_PLAN}&page=` + page + (due ? '&due=true' : '')),
  createStudyPlan: (body: { contentId: string; title: string; targetMinutes: number; scheduledAt: string; remindAt: string }): Promise<StudyPlan> => apiRequest('/api/study-plans', { method: 'POST', body }),
  completeStudyPlan: (id: string, completed: boolean): Promise<StudyPlan> => apiRequest('/api/study-plans/' + encodeURIComponent(id), { method: 'PATCH', body: { completed } }),
  deleteStudyPlan: (id: string): Promise<{ deleted: boolean }> => apiRequest('/api/study-plans/' + encodeURIComponent(id), { method: 'DELETE' }),
  exercises: (params: { contentId?: string; pointId?: string; type?: string; status?: string; page?: number }): Promise<BankList> => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, String(value)); });
    return apiRequest('/api/exercises?' + search.toString());
  },
  logout: (): Promise<{ loggedOut: boolean }> => apiRequest('/api/auth/logout', { method: 'POST' }),
  contents: (type?: 'video' | 'document'): Promise<ContentList> => collectPages<ContentSummary>(`/api/contents?pageSize=${PAGE_SIZES.CONTENT}${type ? `&type=${type}` : ''}`, (item) => item.contentId),
  createUploadIntent: (body: { contentId?: string; contentType: 'video' | 'document'; fileName: string; fileSize: number; mimeType: string }): Promise<UploadIntent> => apiRequest<UploadIntent>('/api/contents/upload-intent', { method: 'POST', body }),
  completeUpload: (id: string, body: { size: number; title: string }): Promise<{ contentId: string; status: string }> => apiRequest(`/api/contents/${id}/complete`, { method: 'POST', body }),
  content: (id: string): Promise<ContentSummary> => apiRequest<ContentSummary>(`/api/contents/${id}`),
  updateContent: (id: string, title: string): Promise<ContentSummary> => apiRequest(`/api/contents/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } }),
  deleteContent: (id: string): Promise<{ contentId: string; deleted: boolean }> => apiRequest(`/api/contents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  resource: (id: string): Promise<Resource> => apiRequest<Resource>(`/api/contents/${id}/resource`),
  understanding: (id: string): Promise<Understanding> => apiRequest<Understanding>(`/api/contents/${id}/understanding`),
  understandingStatus: (id: string): Promise<{ contentId: string; phase: string; stageDetail: unknown; failureReason?: string }> => apiRequest(`/api/contents/${id}/understanding/status`),
  generatedNote: (id: string): Promise<{ note: GeneratedNote | null }> => apiRequest(`/api/contents/${id}/generated-note`),
  regenerateGeneratedNote: (id: string): Promise<{ note: GeneratedNote | null }> => apiRequest(`/api/contents/${id}/generated-note`, { method: 'POST' }),
  notes: (id: string): Promise<{ items: NoteItem[] }> => apiRequest(`/api/contents/${id}/notes`),
  personalNotes: (params: { q?: string; contentId?: string; page?: number; pageSize?: number }): Promise<PersonalNoteList> => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]): void => { if (value !== undefined && value !== '') search.set(key, String(value)); });
    return apiRequest('/api/notes?' + search.toString());
  },
  searchNotes: (query: string, page = 1, pageSize = 20): Promise<NoteSearchResult> => {
    const search = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
    return apiRequest<NoteSearchResult>(`/api/notes/search?${search.toString()}`);
  },
  exportNotes: (id: string, format: 'markdown' | 'txt'): Promise<NoteExportResult> =>
    apiRequest<NoteExportResult>(`/api/contents/${encodeURIComponent(id)}/notes/export`, { method: 'POST', body: { format } }),
  createNote: (id: string, body: { content: string; ref: NoteItem['ref'] }): Promise<NoteItem> => apiRequest(`/api/contents/${id}/notes`, { method: 'POST', body }),
  updateNote: (id: string, body: { content: string; expectedVersion: number }): Promise<NoteItem & { isOverwritten: boolean }> => apiRequest(`/api/notes/${id}`, { method: 'PATCH', body }),
  deleteNote: (id: string): Promise<{ noteId: string; deleted: boolean }> => apiRequest(`/api/notes/${id}`, { method: 'DELETE' }),
  progress: (id: string): Promise<Progress> => apiRequest(`/api/contents/${id}/progress`),
  saveProgress: (id: string, body: { contentType: 'video'; positionSec: number } | { contentType: 'document'; page: number; scrollRatio: number }): Promise<Progress> => apiRequest(`/api/contents/${id}/progress`, { method: 'PUT', body }),
  qa: (id: string, question: string): Promise<QaResult> => apiRequest(`/api/contents/${id}/ai/qa`, { method: 'POST', body: { question } }),
  summary: (id: string): Promise<SummaryResult> => apiRequest(`/api/contents/${id}/ai/summary`, { method: 'POST' }),
  flashcards: (due = true, contentId?: string): Promise<{ total: number; items: Flashcard[] }> => collectPages<Flashcard>(`/api/flashcards?due=${due}&pageSize=${PAGE_SIZES.FLASHCARD}${contentId ? `&contentId=${encodeURIComponent(contentId)}` : ''}`, (item) => item.flashcardId),
  review: async (id: string, rating: number): Promise<ReviewResult> => {
    const result = await apiRequest<ReviewResult>(`/api/flashcards/${id}/review`, { method: 'POST', body: { rating } });
    notifyProfileUpdated();
    return result;
  },
  weakPoints: (): Promise<{ items: WeakPoint[] }> => apiRequest('/api/mastery/weak-points'),
  mastery: (): Promise<{ items: MasteryItem[] }> => apiRequest('/api/mastery'),
  contentGraph: (id: string): Promise<ContentGraph> => apiRequest(`/api/contents/${encodeURIComponent(id)}/graph`),
  graphOverview: (): Promise<GraphOverview> => apiRequest('/api/graph/overview'),
  profile: (): Promise<Profile> => apiRequest('/api/gamification/profile'),
  adminOverview: (): Promise<AdminOverview> => apiRequest('/api/admin/overview'),
  adminUsers: (params: { query?: string; role?: 'admin' | 'teacher' | 'student'; page?: number; pageSize?: number } = {}): Promise<AdminUserList> => {
    const search = new URLSearchParams();
    if (params.query) search.set('query', params.query);
    if (params.role) search.set('role', params.role);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    return apiRequest<AdminUserList>(`/api/admin/users?${search.toString()}`);
  },
  createAdminUser: (body: { account: string; nickname: string; password: string; role: 'admin' | 'teacher' | 'student' }): Promise<{ user: AdminUser }> => apiRequest('/api/admin/users', { method: 'POST', body }),
  updateAdminUser: (id: string, body: { nickname?: string; password?: string; role?: 'admin' | 'teacher' | 'student' }): Promise<{ user: AdminUser }> => apiRequest(`/api/admin/users/${id}`, { method: 'PATCH', body }),
  deleteAdminUser: (id: string): Promise<{ id: string; deleted: boolean }> => apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' }),
  generateExercise: (body: { pointIds?: string[]; count?: number; type?: Exercise['type'] }): Promise<{ questions: Exercise[] }> => apiRequest('/api/exercises/generate', { method: 'POST', body }),
  answerExercise: (id: string, userAnswer: string): Promise<{ correct: boolean; correctAnswer: string; explanation: string; masteryDelta: number }> => apiRequest(`/api/exercises/${id}/answer`, { method: 'POST', body: { userAnswer } }),
};
