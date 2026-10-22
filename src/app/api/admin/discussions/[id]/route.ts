import { sharedRoute } from '@/lib/courses/routes';
import { assertAdmin } from '@/lib/auth/admin';
import { moderateThread, adminThreadDetail } from '@/lib/discussions/moderation';
export const GET = sharedRoute<{params:{id:string}}>(async(_request,{user,params}):Promise<Response>=>{await assertAdmin(user);return adminThreadDetail(user,params.id);});
export const PATCH = sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>{await assertAdmin(user);return moderateThread(request,user,params.id);});
