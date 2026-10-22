import { sharedRoute } from '@/lib/courses/routes';
import { assertAdmin } from '@/lib/auth/admin';
import { adminThreads } from '@/lib/discussions/moderation';
export const GET = sharedRoute(async(request,{user}):Promise<Response>=>{await assertAdmin(user);return adminThreads(request,user);});
