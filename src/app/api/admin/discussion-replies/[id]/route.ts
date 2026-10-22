import { sharedRoute } from '@/lib/courses/routes';
import { assertAdmin } from '@/lib/auth/admin';
import { moderateReply } from '@/lib/discussions/moderation';
export const PATCH = sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>{await assertAdmin(user);return moderateReply(request,user,params.id);});
