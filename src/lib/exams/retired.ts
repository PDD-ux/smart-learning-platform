import { fail } from '@/lib/api/response';

/** Permanent tombstone: never inspect request credentials, IDs, bodies or stored records. */
export function examRetiredResponse(): Response {
  const response = fail('EXAM_RETIRED', '试卷功能已下线，当前不提供试卷和历史答卷在线查询。', 410);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function examRetiredHead(): Response {
  const response = examRetiredResponse();
  return new Response(null, { status: response.status, headers: response.headers });
}
