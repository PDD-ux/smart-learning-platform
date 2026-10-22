import {withAuth} from '@/lib/auth/middleware';
import {privateResponse} from '@/lib/api/private-response';
import {ok} from '@/lib/api/response';
import {listTopics,createTopic} from '@/lib/study-topics/service';
export const runtime='nodejs';
export const GET=privateResponse(withAuth(async(_request,{user}):Promise<Response>=>ok(await listTopics(user))));
export const POST=privateResponse(withAuth(async(request,{user}):Promise<Response>=>ok(await createTopic(request,user))));
