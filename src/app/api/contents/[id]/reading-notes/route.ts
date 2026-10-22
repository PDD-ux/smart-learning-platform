import {withAuth} from '@/lib/auth/middleware';
import {ok} from '@/lib/api/response';
import {privateResponse} from '@/lib/api/private-response';
import {readReadingNotes,writeReadingNotes} from '@/lib/reading-notes/service';
export const runtime='nodejs';
export const GET=privateResponse(withAuth<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>ok(await readReadingNotes(request,user,params.id))));
export const POST=privateResponse(withAuth<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>ok(await writeReadingNotes(request,user,params.id))));
