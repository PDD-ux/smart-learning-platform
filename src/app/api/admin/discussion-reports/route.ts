import { sharedRoute } from '@/lib/courses/routes';
import { assertAdmin } from '@/lib/auth/admin';
import { listReports } from '@/lib/discussions/moderation';
export const GET = sharedRoute(async(request,{user}):Promise<Response>=>{await assertAdmin(user);return listReports(request,user,true);});
