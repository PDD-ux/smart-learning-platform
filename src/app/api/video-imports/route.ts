import { withAuth } from '@/lib/auth/middleware';
import { ok } from '@/lib/api/response';
import { privateUrlResponse } from '@/lib/url-imports/routes';
import { importVideoUrl } from '@/lib/video-imports/service';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const POST = privateUrlResponse(withAuth(async (request, { user }): Promise<Response> => ok(await importVideoUrl(request, user))));
