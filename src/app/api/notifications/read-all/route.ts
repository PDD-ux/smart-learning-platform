import { sharedRoute } from '@/lib/courses/routes';
import { markAllMessages } from '@/lib/discussions/notifications';
export const POST = sharedRoute(async (request, { user }): Promise<Response> => markAllMessages(request, user));
