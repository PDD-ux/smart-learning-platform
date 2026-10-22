import { sharedRoute } from '@/lib/courses/routes';
import { listThreads,createThread } from '@/lib/discussions/service';
export const GET=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>listThreads(request,user,params.id));
export const POST=sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>createThread(request,user,params.id));
