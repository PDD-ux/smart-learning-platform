import { courseList, sharedRoute } from '@/lib/courses/routes';
export const GET = sharedRoute(async (request, { user }): Promise<Response> => courseList(request, user, false));
