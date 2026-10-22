import {withAuth} from '@/lib/auth/middleware';
import {ok} from '@/lib/api/response';
import {confirmUrlDraft} from '@/lib/url-imports/service';
import {privateUrlResponse} from '@/lib/url-imports/routes';
export const runtime='nodejs';
export const POST=privateUrlResponse(withAuth<{params:{requestId:string}}>(async(request,{user,params}):Promise<Response>=>ok(await confirmUrlDraft(request,user,params.requestId))));
