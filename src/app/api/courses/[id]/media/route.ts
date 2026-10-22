import { courseMedia, sharedRoute } from '@/lib/courses/routes';
export const runtime = 'nodejs';
export const GET = sharedRoute<{ params: { id: string } }>(async (request, { user, params }): Promise<Response> => courseMedia(request, user, params.id, false));
export const HEAD = GET;
