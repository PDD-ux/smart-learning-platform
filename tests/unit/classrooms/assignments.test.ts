import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assignmentCommandSchema, reviewSchema, attachmentIntentSchema } from '@/lib/classrooms/assignment-contracts';
import { validateAssignmentFile } from '@/lib/classrooms/attachment-format';
import { assignmentBytes, assignmentHandlers } from '@/lib/classrooms/assignment-routes';
import { LocalStorageClient } from '@/lib/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
describe('assignment boundaries',():void=>{
 it('requires explicit submission/review consent and validates score policy',():void=>{
  const base={requestId:crypto.randomUUID(),expectedRevision:1,assignmentRevision:1,action:'submit',confirmed:true,attachmentIds:[]};expect(assignmentCommandSchema.safeParse(base).success).toBe(true);
  for(const bad of [{...base,confirmed:false},{...base,studentId:'other'},{...base,attachmentIds:['same','same']}])expect(assignmentCommandSchema.safeParse(bad).success).toBe(false);
  const review={requestId:base.requestId,action:'review',expectedRevision:1,versionId:'version',state:'RETURNED',score:null,feedback:'请补充推理',confirmed:true};expect(reviewSchema.safeParse(review).success).toBe(true);
  for(const bad of [{...review,score:80},{...review,state:'GRADED'},{...review,state:'GRADED',score:1.5},{...review,state:'GRADED',score:101},{...review,feedback:''},{...review,confirmed:false}])expect(reviewSchema.safeParse(bad).success).toBe(false);
 });
 it('accepts valid attachment metadata and rejects spoofed extensions/paths/extra keys',():void=>{
  const input={requestId:crypto.randomUUID(),expectedRevision:1,fileName:'作业.txt',mimeType:'text/plain',sizeBytes:12};expect(attachmentIntentSchema.safeParse(input).success).toBe(true);
  for(const bad of [{...input,fileName:'x.exe'},{...input,fileName:'../作业.txt'},{...input,sizeBytes:20971521},{...input,storageKey:'private/other'}])expect(attachmentIntentSchema.safeParse(bad).success).toBe(false);
 });
 it('validates UTF8 and actual PDF/image structure rather than trusting declared MIME',async():Promise<void>=>{
  await validateAssignmentFile(Buffer.from('函数定义\n课堂作业'),'text/plain');
  for(const [bytes,mime] of [[Buffer.from([255,0]),'text/plain'],[Buffer.from('not a PDF'),'application/pdf'],[Buffer.from('fake'),'image/png'],[Buffer.from('fake'),'image/jpeg']] as const)await expect(validateAssignmentFile(bytes,mime)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 });
 it('bounds actual binary stream length and rejects anonymous handlers privately',async():Promise<void>=>{
  await expect(assignmentBytes(new NextRequest('http://local/file',{method:'POST',body:'123456'}),5)).rejects.toMatchObject({code:'FILE_TOO_LARGE'});
  const handlers=assignmentHandlers();for(const route of [handlers.TASK,handlers.WRITE,handlers.SUBMISSION,handlers.REVIEW,handlers.INTENT,handlers.UPLOAD,handlers.TICKET,handlers.DOWNLOAD]){const response=await route(new NextRequest('http://local'),{params:{id:'none'}});expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('private, no-store');}
 });
 it('immutable local object creation accepts one writer and never replaces bytes',async():Promise<void>=>{
  const root=await mkdtemp(path.join(tmpdir(),'slp-assignment-storage-'));try{const storage=new LocalStorageClient(root);const outcomes=await Promise.all([storage.putObjectIfAbsent('owned/file.txt',Buffer.from('one'),'text/plain'),storage.putObjectIfAbsent('owned/file.txt',Buffer.from('two'),'text/plain')]);expect(outcomes.filter(Boolean)).toHaveLength(1);const object=await storage.getObject('owned/file.txt');const chunks:Buffer[]=[];for await(const part of object.stream)chunks.push(Buffer.from(part as Uint8Array));expect(Buffer.concat(chunks).toString()).toBe(outcomes[0]?'one':'two');}finally{if(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(root).startsWith('slp-assignment-storage-'))await rm(root,{recursive:true,force:true});}
 });
});
