import { withAuth } from '@/lib/auth/middleware';
import { privateResponse } from '@/lib/api/private-response';
import { ok } from '@/lib/api/response';
import { teacherOverview } from '@/lib/classrooms/teacher-overview';

const authenticated = withAuth(async (_request, { user }): Promise<Response> => ok(await teacherOverview(user.id)));

export const GET = privateResponse(authenticated);
