import {withAuth} from '@/lib/auth/middleware';
import {ok} from '@/lib/api/response';
import {privateResponse} from '@/lib/api/private-response';
import {exportReadingNotes} from '@/lib/reading-notes/export';
export const runtime='nodejs';
export const POST=privateResponse(withAuth<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>ok(await exportReadingNotes(request,user,params.id))));
