import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus } from '@/lib/api/response';

const RETIRED_MESSAGE = '麦克风课堂笔记功能已下线，请在已导入的视频学习页面使用随看笔记。';

/** Tombstone for the retired microphone-recording workflow; it never reads stored sessions. */
export function liveNotesRetiredResponse(): Response {
  const response = fail(ErrorCode.LIVE_NOTES_RETIRED, RETIRED_MESSAGE, HttpStatus.GONE);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie, Authorization');
  return response;
}

/** HEAD keeps the same retirement status without returning a response body. */
export function liveNotesRetiredHead(): Response {
  const response = liveNotesRetiredResponse();
  return new Response(null, { status: response.status, headers: response.headers });
}
