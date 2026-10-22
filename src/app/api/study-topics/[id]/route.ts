import {withAuth} from '@/lib/auth/middleware';
import {privateResponse} from '@/lib/api/private-response';
import {ok} from '@/lib/api/response';
import {topicView,commandTopic} from '@/lib/study-topics/service';
export const runtime='nodejs';
export const GET=privateResponse(withAuth<{params:{id:string}}>(async(_request,{user,params}):Promise<Response>=>ok(await topicView(params.id,user))));
export const POST=privateResponse(withAuth<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>ok(await commandTopic(request,user,params.id))));
