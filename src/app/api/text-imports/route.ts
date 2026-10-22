import {withAuth} from '@/lib/auth/middleware';
import {privateResponse} from '@/lib/api/private-response';
import {ok} from '@/lib/api/response';
import {importText} from '@/lib/text-imports/service';
export const runtime='nodejs';
export const POST=privateResponse(withAuth(async(request,{user}):Promise<Response>=>ok(await importText(request,user))));
