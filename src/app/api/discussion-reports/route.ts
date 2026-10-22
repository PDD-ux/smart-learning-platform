import { sharedRoute } from '@/lib/courses/routes';
import { listReports } from '@/lib/discussions/moderation';
export const GET = sharedRoute(async(request,{user}):Promise<Response>=>listReports(request,user,false));
