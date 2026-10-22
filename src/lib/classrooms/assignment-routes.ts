import { z } from 'zod';
import { parse } from './service';
import type { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { withAuth, type AuthedHandler, type RouteHandler } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { privateResponse } from '@/lib/api/private-response';
import { rateLimit } from '@/lib/api/rate-limit';
import { getStorage, type StorageClient } from '@/lib/storage';
import { prisma } from '@/lib/prisma';
import { classId } from './contracts';
import { classPage, classBody } from './routes';
import { assignmentView, assignmentCommand, readSubmission, reviewSubmission, submissionHistory } from './assignments';
import { createAssignmentAttachment, uploadAssignmentAttachment, removeAssignmentAttachment, attachmentDownloadTicket, downloadAssignmentAttachment } from './attachments';
type Params = { params: { id: string } };
function wrap<P>(handler: AuthedHandler<P>): RouteHandler<P> { const auth = withAuth(handler); return async (req, ctx): Promise<Response> => privateResponse((): Promise<Response> | Response => auth(req, ctx))(); }
function id(raw: string): string { const result = classId.safeParse(raw); if (!result.success) throw new ApiError(ErrorCode.NOT_FOUND,'作业资源不存在或不可访问'); return result.data; }
async function limit(actorId: string, file = false): Promise<void> { const result = await rateLimit('assignment:'+actorId+(file?':file':':write'),file?10:40,60000);if(!result.allowed)throw new ApiError(ErrorCode.RATE_LIMITED,'操作频繁，请一分钟后再试'); }
export async function assignmentBytes(request: NextRequest, maxBytes = 20*1024*1024): Promise<Buffer> {
 const reader=request.body?.getReader();if(!reader)throw new ApiError(ErrorCode.VALIDATION_FAILED,'缺少附件正文');
 const chunks:Uint8Array[]=[];let length=0;let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_resolve,reject):void=>{timer=setTimeout(():void=>reject(new ApiError(ErrorCode.VALIDATION_FAILED,'上传超过60秒，请保留文件并手动重试')),60000);});
 try{for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;length+=part.value.byteLength;if(length>maxBytes)throw new ApiError(ErrorCode.FILE_TOO_LARGE,'附件超过允许大小');chunks.push(part.value);}return Buffer.concat(chunks);}finally{clearTimeout(timer);await reader.cancel().catch(():void=>undefined);reader.releaseLock();}
}
export function assignmentHandlers(db:PrismaClient=prisma,storage:StorageClient=getStorage()):{TASK:RouteHandler<Params>;WRITE:RouteHandler<Params>;HISTORY:RouteHandler;SUBMISSION:RouteHandler<Params>;REVIEW:RouteHandler<Params>;INTENT:RouteHandler<Params>;UPLOAD:RouteHandler<Params>;REMOVE:RouteHandler<Params>;TICKET:RouteHandler<Params>;DOWNLOAD:RouteHandler<Params>}{
 return{
 TASK:wrap<Params>(async(req,{user,params}):Promise<Response>=>ok(await assignmentView(user.id,id(params.id),classPage(req),db))),
 WRITE:wrap<Params>(async(req,{user,params}):Promise<Response>=>{await limit(user.id);return ok(await assignmentCommand(user.id,id(params.id),await classBody(req,256*1024),db));}),
 HISTORY:wrap(async(req,{user}):Promise<Response>=>ok(await submissionHistory(user.id,classPage(req),db))),
 SUBMISSION:wrap<Params>(async(_req,{user,params}):Promise<Response>=>ok(await readSubmission(user.id,id(params.id),db))),
 REVIEW:wrap<Params>(async(req,{user,params}):Promise<Response>=>{await limit(user.id);return ok(await reviewSubmission(user.id,id(params.id),await classBody(req,256*1024),db));}),
 INTENT:wrap<Params>(async(req,{user,params}):Promise<Response>=>{await limit(user.id,true);return ok(await createAssignmentAttachment(user.id,id(params.id),await classBody(req),db));}),
 UPLOAD:wrap<Params>(async(req,{user,params}):Promise<Response>=>{await limit(user.id,true);return ok(await uploadAssignmentAttachment(user.id,id(params.id),():Promise<Buffer>=>assignmentBytes(req),db,storage));}),
 REMOVE:wrap<Params>(async(req,{user,params}):Promise<Response>=>{await limit(user.id);return ok(await removeAssignmentAttachment(user.id,id(params.id),await classBody(req),db,storage));}),
 TICKET:wrap<Params>(async(_req,{user,params}):Promise<Response>=>{await limit(user.id);return ok(await attachmentDownloadTicket(user.id,id(params.id),db));}),
 DOWNLOAD:wrap<Params>(async(req,{user,params}):Promise<Response>=>{const proof=parse(z.object({expires:z.number().int().positive(),sig:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)}).strict(),await classBody(req));return downloadAssignmentAttachment(user.id,id(params.id),proof.expires,proof.sig,db,storage);}),
 };
}


