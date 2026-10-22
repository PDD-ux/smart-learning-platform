import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth, type AuthedHandler, type RouteHandler } from '@/lib/auth/middleware';
import { privateResponse } from '@/lib/api/private-response';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { classBody, classPage } from '@/lib/classrooms/routes';
import { createHomework, readHomework, listHomework, commandHomework } from './service';
type Params={params:{id:string}};
function wrap<P>(handler:AuthedHandler<P>):RouteHandler<P>{const auth=withAuth(handler);return async(req,ctx):Promise<Response>=>privateResponse(():Promise<Response>|Response=>auth(req,ctx))();}
async function limited(actor:string,create=false):Promise<void>{if(!(await rateLimit('homework:'+actor+(create?':create':':write'),create?5:40,60000)).allowed)throw new ApiError(ErrorCode.RATE_LIMITED,'操作频繁，请一分钟后重试');}
function id(value:string):string{if(!/^[0-9a-f-]{36}$/iu.test(value))throw new ApiError(ErrorCode.NOT_FOUND,'作业校对记录不存在或不可访问');return value;}
export function homeworkHandlers(db:PrismaClient=prisma):{LIST:RouteHandler;CREATE:RouteHandler;READ:RouteHandler<Params>;WRITE:RouteHandler<Params>}{return{
 LIST:wrap(async(req,{user}):Promise<Response>=>ok(await listHomework(user.id,classPage(req),db))),
 CREATE:wrap(async(req,{user}):Promise<Response>=>{await limited(user.id,true);return ok(await createHomework(user.id,await classBody(req,6*1024*1024),db));}),
 READ:wrap<Params>(async(_req,{user,params}):Promise<Response>=>ok(await readHomework(user.id,id(params.id),db))),
 WRITE:wrap<Params>(async(req,{user,params}):Promise<Response>=>{await limited(user.id);return ok(await commandHomework(user.id,id(params.id),await classBody(req,1024*1024),db));}),
};}
