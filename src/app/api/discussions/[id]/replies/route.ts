import { sharedRoute } from '@/lib/courses/routes';
import { listReplies,createReply } from '@/lib/discussions/service';
export const GET=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>listReplies(request,user,params.id));
export const POST=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>createReply(request,user,params.id));
