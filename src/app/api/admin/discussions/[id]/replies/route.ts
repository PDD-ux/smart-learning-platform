import { sharedRoute } from '@/lib/courses/routes';
import { assertAdmin } from '@/lib/auth/admin';
import { adminReplies } from '@/lib/discussions/moderation';
export const GET = sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>{await assertAdmin(user);return adminReplies(request,user,params.id);});
