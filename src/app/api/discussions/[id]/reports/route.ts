import { sharedRoute } from '@/lib/courses/routes';
import { createReport } from '@/lib/discussions/moderation';
export const POST = sharedRoute<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>createReport(request,user,params.id));
