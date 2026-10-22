import { sharedRoute } from '@/lib/courses/routes';
import { changeReply } from '@/lib/discussions/service';
export const PATCH=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>changeReply(request,user,params.id,false));
export const DELETE=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>changeReply(request,user,params.id,true));
