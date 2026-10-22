import { courseList, coursePrepare, sharedRoute } from '@/lib/courses/routes';
export const GET = sharedRoute(async (request, { user }): Promise<Response> => courseList(request, user, true));
export const POST = sharedRoute(async (request, { user }): Promise<Response> => coursePrepare(request, user));
