import { courseMedia, sharedRoute } from '@/lib/courses/routes';
export const runtime = 'nodejs';
export const GET = sharedRoute<{ params: { id: string; page: string } }>(async (request, { user, params }): Promise<Response> => courseMedia(request, user, params.id, true, params.page));
export const HEAD = GET;
