import {loadEnvConfig} from '@next/env';
import {PrismaClient} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {getStorage} from '../../src/lib/storage';
import {signAccessToken} from '../../src/lib/auth/jwt';
import type {BookResult,BookCommand,BookView} from '../../src/lib/books/contracts';

loadEnvConfig(process.cwd(),true,{info:():void=>undefined,error:():void=>undefined});
// Prisma can preload .env. Match Next development's .env.local priority without logging credentials.
Object.assign(process.env,parseEnv(readFileSync('.env.local','utf8')));
const db=new PrismaClient();const directory=path.resolve('.taskbook-working/book-reading-20261018');const base='http://127.0.0.1:3000';
type Fixture={run:string;users:string[];owner:string;account:string;password:string;contents:Record<string,string>;keys:string[];checks:{name:string;status:number}[]};
const privatePath=path.join(directory,'fixtures.private.json');
async function request<T>(fixture:Fixture,name:string,id:string,method='GET',body?:unknown,asUser=fixture.owner,role='student',status=200,suffix=''):Promise<T>{
  const response=await fetch(`${base}/api/contents/${id}/book${suffix}`,{method,headers:{'content-type':'application/json',...(asUser?{authorization:`Bearer ${signAccessToken({sub:asUser,email:null,role},3600)}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,status,name);assert.equal(response.headers.get('cache-control'),'private, no-store');fixture.checks.push({name,status:response.status});
  const result=await response.json() as {data:T};return result.data;
}
function command(book:BookView,action:Record<string,unknown>):unknown{return{...action,expectedRevision:book.revision,requestId:randomUUID(),sourceDigest:book.sourceDigest};}
async function cleanup(fixture:Fixture):Promise<void>{
  assert.ok(/^book-reading-[a-f0-9-]+$/u.test(fixture.run));
  assert.ok(fixture.users.every((id):boolean=>id.startsWith(fixture.run)));
  await db.auditLog.deleteMany({where:{actorId:{in:fixture.users}}});
  for(const id of fixture.users){assert.ok(id.startsWith(fixture.run));await db.user.deleteMany({where:{id}});}
  for(const key of fixture.keys){assert.ok(key.startsWith(`acceptance/${fixture.run}/`));await getStorage().deleteObject(key);}
  await writeFile(path.join(directory,'cleanup.json'),JSON.stringify({usersRemoved:await db.user.count({where:{id:{in:fixture.users}}})===0,contentsRemoved:await db.learningContent.count({where:{id:{in:Object.values(fixture.contents)}}})===0,onlySyntheticObjectsDeleted:true}));
  await writeFile(privatePath,JSON.stringify({...fixture,password:''}));
}
async function main():Promise<void>{
  await mkdir(directory,{recursive:true});
  assert.ok(process.argv[2]===undefined||process.argv[2]==='cleanup','Only run without arguments or with cleanup');
  if(process.argv[2]==='cleanup'){const fixture=JSON.parse(await readFile(privatePath,'utf8')) as Fixture;await cleanup(fixture);console.log('Synthetic book fixtures cleaned.');return;}
  if(existsSync(privatePath))assert.equal((JSON.parse(readFileSync(privatePath,'utf8')) as Fixture).password,'','Clean the previous book acceptance run before creating another');
  const run=`book-reading-${randomUUID()}`;const password=randomUUID()+'!Aa9';
  const fixture:Fixture={run,users:[`${run}-owner`,`${run}-other`,`${run}-admin`],owner:`${run}-owner`,account:`${run}@example.invalid`,password,contents:{},keys:[],checks:[]};
  await writeFile(privatePath,JSON.stringify(fixture));
  try{
    for(const [index,id]of fixture.users.entries())await db.user.create({data:{id,email:index===0?fixture.account:null,nickname:index===0?'书籍验收临时学员':'书籍隔离临时账号',role:index===2?'admin':'student',passwordHash:await bcrypt.hash(password,10)}});
    const original=await db.learningContent.findFirst({where:{format:'PDF',status:'READY'},orderBy:{pageCount:'desc'}});assert.ok(original?.pageCount&&original.pageCount>20,'Existing long PDF needed for bounded real-page acceptance');
    for(const format of ['MD','TXT','PDF'] as const){
      let key=original.storageKey,size=original.fileSizeBytes;
      if(format!=='PDF'){
        const body=format==='MD'?Array.from({length:12},(_,chapter):string=>`# 第${chapter+1}章 自主学习\n\n`+Array.from({length:20},(_,index):string=>`第${chapter+1}章第${index+1}段：学习需要明确目标，理解原文并记录自己的疑问。这是原创验收正文，不是外部教材。`).join('\n\n')).join('\n\n'):'第一章 阅读基础\n\n先阅读原文，再整理自己的理解。\n\n第二章 学习方法\n\n复习应当依据实际学习记录，而不是虚构进度。';
        const bytes=Buffer.from(body);key=`acceptance/${run}/original.${format.toLowerCase()}`;size=BigInt(bytes.length);fixture.keys.push(key);await getStorage().putObject(key,bytes,{contentType:'text/plain;charset=utf-8'});
      }
      const content=await db.learningContent.create({data:{ownerId:fixture.owner,contentType:'DOCUMENT',title:`书籍验收 ${format}（临时）`,fileName:`original.${format.toLowerCase()}`,format,storageKey:key,fileSizeBytes:size,pageCount:format==='PDF'?original.pageCount:1,status:'READY'}});fixture.contents[format]=content.id;
    }
    await writeFile(privatePath,JSON.stringify(fixture));
    const md=fixture.contents.MD;await db.note.create({data:{ownerId:fixture.owner,contentId:md,content:'原有个人笔记不可被重新分章覆盖',ref:{type:'document',page:1,blockIndex:2}}});await db.textBlock.create({data:{contentId:md,ref:{type:'document',page:1,blockIndex:0},source:'MD',sequence:0,text:'原有导入产物不可被选段提取覆盖'}});
    const originalNotes=await db.note.findMany({where:{contentId:md}}),originalBlocks=await db.textBlock.findMany({where:{contentId:md}});
    const init={action:'initialize',expectedRevision:0,requestId:randomUUID()};
    assert.equal((await request<BookResult>(fixture,'GET does not initialize',md)).book,null);
    await request(fixture,'anonymous rejected',md,'GET',undefined,'','student',401);
    await request(fixture,'other student rejected',md,'GET',undefined,fixture.users[1],'student',403);
    await request(fixture,'admin not owner rejected',md,'POST',init,fixture.users[2],'admin',403);
    await request(fixture,'invalid account rejected',md,'GET',undefined,run+'-missing','student',401);
    let book=(await request<BookResult>(fixture,'MD original heading index',md,'POST',init)).book!;await writeFile(path.join(directory,'md-initialize.json'),JSON.stringify(book));assert.equal(book.unitCount,252);assert.equal(book.processedCount,0);assert.equal(book.chapters[0].origin,'heading');
    const extract=command(book,{action:'extract',start:22,end:24});book=(await request<BookResult>(fixture,'MD bounded extraction',md,'POST',extract)).book!;assert.equal(book.processedCount,3);assert.equal(book.cursor,22);assert.equal(book.readingUnits[0].position,22);
    const replay=(await request<BookResult>(fixture,'repeat request does not duplicate',md,'POST',extract)).book!;assert.equal(replay.revision,book.revision);assert.equal(replay.processedCount,3);
    await request(fixture,'same request key different content rejected',md,'POST',{...(extract as object),start:23},fixture.owner,'student',409);
    await request(fixture,'overlap rejected',md,'POST',command(book,{action:'chapters',chapters:[{title:'一',start:1,end:5},{title:'二',start:5,end:10}]}),fixture.owner,'student',400);
    await request(fixture,'oversized range rejected',md,'POST',command(book,{action:'extract',start:1,end:21}),fixture.owner,'student',400);
    await request(fixture,'unknown request field rejected',md,'POST',{...(command(book,{action:'cursor',position:5}) as object),ownerId:'other'},fixture.owner,'student',400);
    await request(fixture,'query range over bound rejected',md,'GET',undefined,fixture.owner,'student',400,'?start=1&end=21');
    await request(fixture,'source hash mismatch rejected',md,'POST',{...(command(book,{action:'cursor',position:5}) as object),sourceDigest:'b'.repeat(64)},fixture.owner,'student',409);
    book=(await request<BookResult>(fixture,'bookmark persist',md,'POST',command(book,{action:'bookmark',position:22,label:'第二章原文'}))).book!;
    const originalRef=JSON.stringify(originalNotes[0].ref);
    book=(await request<BookResult>(fixture,'manual chapters preserve original anchors',md,'POST',command(book,{action:'chapters',chapters:[{title:'本人前半部分',start:1,end:126},{title:'本人后半部分',start:127,end:252}]}))).book!;assert.equal(book.chapters[0].origin,'manual');assert.equal(book.bookmarks[0].position,22);
    const stale=command({...book,revision:book.revision-1},{action:'cursor',position:5});await request(fixture,'stale writer rejected',md,'POST',stale,fixture.owner,'student',409);
    book=(await request<BookResult>(fixture,'continue location saved',md,'POST',command(book,{action:'cursor',position:23}))).book!;
    const restored=(await request<BookResult>(fixture,'fresh GET resumes original paragraph',md)).book!;assert.equal(restored.start,23);assert.equal(restored.bookmarks[0].position,22);assert.equal(restored.readableCount,3);
    assert.deepEqual(await db.note.findMany({where:{contentId:md}}),originalNotes);assert.deepEqual(await db.textBlock.findMany({where:{contentId:md}}),originalBlocks);assert.equal(JSON.stringify((await db.note.findMany({where:{contentId:md}}))[0].ref),originalRef);
    let txt=(await request<BookResult>(fixture,'TXT Chinese headings',fixture.contents.TXT,'POST',{...init,requestId:randomUUID()})).book!;assert.equal(txt.chapters.length,2);txt=(await request<BookResult>(fixture,'TXT original paragraphs extracted',fixture.contents.TXT,'POST',command(txt,{action:'extract',start:1,end:4}))).book!;assert.equal(txt.readableCount,4);
    const key=fixture.keys.find((value):boolean=>value.endsWith('.txt'))!;await getStorage().putObject(key,Buffer.from('已改变的测试文件'),{contentType:'text/plain'});await request(fixture,'changed source file rejected without rewriting old index',fixture.contents.TXT,'POST',command(txt,{action:'extract',start:1,end:1}),fixture.owner,'student',409);assert.equal((await request<BookResult>(fixture,'old source index remains intact',fixture.contents.TXT)).book?.revision,txt.revision);
    let pdf=(await request<BookResult>(fixture,'real long PDF actual directory',fixture.contents.PDF,'POST',{...init,requestId:randomUUID()})).book!;assert.equal(pdf.unitCount,original.pageCount);pdf=(await request<BookResult>(fixture,'real PDF first three pages only',fixture.contents.PDF,'POST',command(pdf,{action:'extract',start:1,end:3}))).book!;assert.equal(pdf.processedCount,3);assert.equal(pdf.unitCount,original.pageCount);assert.ok(pdf.unitCount>pdf.processedCount);
    book=(await request<BookResult>(fixture,'remove bookmark explicit',md,'POST',command(book,{action:'removeBookmark',position:22}))).book!;assert.equal(book.bookmarks.length,0);
    await writeFile(privatePath,JSON.stringify(fixture));
    await writeFile(path.join(directory,'http.json'),JSON.stringify({time:new Date().toISOString(),checks:fixture.checks,originalMdBlocksAndNotesUnchanged:true,formats:['PDF','TXT','MD'],mdUnits:252,pdfPages:pdf.unitCount,pdfProcessed:pdf.processedCount,pdfReadable:pdf.readableCount,pdfNeedsOcr:pdf.needsOcrCount,pdfChapterOrigins:[...new Set(pdf.chapters.map((item):string=>item.origin))],realModelCalled:false,sourceChangedRefused:true,oldAnchorsPreserved:true},null,2));
    console.log(JSON.stringify({checks:fixture.checks.length,formats:['PDF','TXT','MD'],mdUnits:252,pdfPages:pdf.unitCount,pdfProcessed:pdf.processedCount,fixturesKeptForBrowser:true}));
  }catch(error){await writeFile(privatePath,JSON.stringify(fixture));await cleanup(fixture);throw error;}
}
main().catch((error:unknown):void=>{console.error(error instanceof Error?error.message:'Book acceptance failed');process.exitCode=1;}).finally(async():Promise<void>=>{await db.$disconnect();});
