import { sharedRoute } from '@/lib/courses/routes';
import { markMessage } from '@/lib/discussions/notifications';
export const PATCH = sharedRoute<{ params: { id: string } }>(async (request, { user, params }): Promise<Response> => markMessage(request, user, params.id));
