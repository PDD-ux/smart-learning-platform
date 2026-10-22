import { courseRead, sharedRoute } from '@/lib/courses/routes';
export const GET = sharedRoute<{ params: { id: string } }>(async (_request, { user, params }): Promise<Response> => courseRead(user, params.id, false));
