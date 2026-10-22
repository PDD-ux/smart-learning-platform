import { sharedRoute } from '@/lib/courses/routes';
import { messageList } from '@/lib/discussions/notifications';
export const GET = sharedRoute(async (request, { user }): Promise<Response> => messageList(request, user));
