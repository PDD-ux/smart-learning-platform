import { sharedRoute } from '@/lib/courses/routes';
import { readThread,changeThread } from '@/lib/discussions/service';
export const GET=sharedRoute<{params:{id:string}}>(async(_request,{user,params}):Promise<Response>=>readThread(user,params.id));
export const PATCH=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>changeThread(request,user,params.id,false));
export const DELETE=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>changeThread(request,user,params.id,true));
