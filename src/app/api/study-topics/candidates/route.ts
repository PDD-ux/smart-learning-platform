import {withAuth} from '@/lib/auth/middleware';
import {privateResponse} from '@/lib/api/private-response';
import {ok} from '@/lib/api/response';
import {candidates} from '@/lib/study-topics/service';
export const runtime='nodejs';
export const GET=privateResponse(withAuth(async(request,{user}):Promise<Response>=>ok(await candidates(request,user))));
