import { sharedRoute } from '@/lib/courses/routes';
import { participated } from '@/lib/discussions/notifications';
export const GET = sharedRoute(async (request, { user }): Promise<Response> => participated(request, user));
