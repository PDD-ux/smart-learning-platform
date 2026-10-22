import {withAuth} from '@/lib/auth/middleware';
import {ok} from '@/lib/api/response';
import {readUrlDraft,cancelUrlDraft} from '@/lib/url-imports/service';
import {privateUrlResponse} from '@/lib/url-imports/routes';
export const runtime='nodejs';
export const GET=privateUrlResponse(withAuth<{params:{requestId:string}}>(async(_request,{user,params}):Promise<Response>=>ok(await readUrlDraft(user,params.requestId))));
export const DELETE=privateUrlResponse(withAuth<{params:{requestId:string}}>(async(_request,{user,params}):Promise<Response>=>ok(await cancelUrlDraft(user,params.requestId))));
