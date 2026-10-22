import { courseRead, courseChange, sharedRoute } from '@/lib/courses/routes';
export const GET = sharedRoute<{ params: { id: string } }>(async (_request, { user, params }): Promise<Response> => courseRead(user, params.id, true));
export const PATCH = sharedRoute<{ params: { id: string } }>(async (request, { user, params }): Promise<Response> => courseChange(request, user, params.id));
