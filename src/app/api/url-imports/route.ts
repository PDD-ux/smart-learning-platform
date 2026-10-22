import {withAuth} from '@/lib/auth/middleware';
import {ok} from '@/lib/api/response';
import {previewUrl} from '@/lib/url-imports/service';
import {privateUrlResponse} from '@/lib/url-imports/routes';
export const runtime='nodejs';
export const POST=privateUrlResponse(withAuth(async(request,{user}):Promise<Response>=>ok(await previewUrl(request,user))));
