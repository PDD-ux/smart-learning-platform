import {beforeEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {RequestOptions,IncomingMessage,ClientRequest} from 'node:http';
const mocks=vi.hoisted(()=>({lookup:vi.fn(),request:vi.fn()}));
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}));
vi.mock('node:http',async(importOriginal)=>({...await importOriginal<object>(),request:mocks.request}));
vi.mock('node:https',()=>({request:mocks.request}));
import {normalizedPublicUrl,publicAddress,publicTarget,fetchPublicDocument,fetchPublicVideo,URL_LIMITS,VIDEO_URL_LIMITS} from '@/lib/url-imports/fetch';
type Reply={status?:number;headers?:Record<string,string|undefined>;body?:Buffer;remote?:string;chunks?:Iterable<Buffer>};
let replies:Reply[],options:RequestOptions[];
beforeEach(():void=>{vi.clearAllMocks();replies=[{body:Buffer.from('<html>actual</html>')}];options=[];mocks.lookup.mockResolvedValue([{address:'93.184.216.34',family:4}]);mocks.request.mockImplementation((_url:URL,opts:RequestOptions,callback:(message:IncomingMessage)=>void):ClientRequest=>{options.push(opts);const emitter=new EventEmitter();const reply=replies.shift()??{};const response=Readable.from(reply.chunks??[reply.body??Buffer.from('actual')]) as IncomingMessage;Object.assign(response,{statusCode:reply.status??200,headers:{'content-type':'text/html',...reply.headers},socket:{remoteAddress:reply.remote??'93.184.216.34'}});Object.assign(emitter,{end:():void=>{queueMicrotask(():void=>{callback(response);});},destroy:(error:Error):void=>{emitter.emit('error',error);}});return emitter as ClientRequest;});});
describe('public URL network boundary',():void=>{
  it.each(['file:///a','ftp://example.org/a','https://u:p@example.org/','https://example.org:444/a','https://example.org./','https://example.org/a b'])('rejects unsafe syntax %s',(url):void=>{expect(()=>normalizedPublicUrl(url)).toThrow();});
  it.each(['127.0.0.1','0.0.0.0','10.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','192.0.2.1'])('blocks special IP %s',(ip):void=>{expect(publicAddress(ip)).toBe(false);});
  it.each(['http://2130706433/','http://0x7f000001/','http://[::ffff:127.0.0.1]/'])('normalizes unusual private literals before rejecting %s',async(url):Promise<void>=>{await expect(publicTarget(normalizedPublicUrl(url))).rejects.toMatchObject({reason:'ADDRESS_BLOCKED'});});
  it('blocks one private address among mixed DNS answers',async():Promise<void>=>{mocks.lookup.mockResolvedValue([{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}]);await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'ADDRESS_BLOCKED'});expect(mocks.request).not.toHaveBeenCalled();});
  it('pins an approved address and sends no credentials',async():Promise<void>=>{const result=await fetchPublicDocument('https://example.org/article#fragment');expect(result.bytes.toString()).toContain('actual');expect(result.finalUrl).toBe('https://example.org/article');expect(options[0].agent).toBe(false);expect(options[0].family).toBe(4);expect(options[0].headers).toEqual({Accept:'text/html,application/xhtml+xml,application/pdf','Accept-Encoding':'identity','User-Agent':'Wenhao-Learning-Import/1.0'});const callback=vi.fn();const lookup=options[0].lookup as (hostname:string,opts:object,callback:ReturnType<typeof vi.fn>)=>void;lookup('example.org',{},callback);expect(callback).toHaveBeenCalledWith(null,'93.184.216.34',4);});
  it('rejects unexpected actual socket address',async():Promise<void>=>{replies=[{remote:'127.0.0.1'}];await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'ADDRESS_BLOCKED'});});
  it('checks every redirect DNS and blocks private target',async():Promise<void>=>{replies=[{status:302,headers:{location:'https://other.example/article'}}];mocks.lookup.mockResolvedValueOnce([{address:'93.184.216.34',family:4}]).mockResolvedValueOnce([{address:'10.1.1.1',family:4}]);await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'ADDRESS_BLOCKED'});expect(mocks.request).toHaveBeenCalledTimes(1);});
  it('rejects HTTPS downgrade and redirect loops',async():Promise<void>=>{replies=[{status:302,headers:{location:'http://example.org/article'}}];await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'ADDRESS_BLOCKED'});replies=[{status:302,headers:{location:'https://example.org/'}}];await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'FETCH_FAILED'});});
  it.each([{headers:{'content-length':String(URL_LIMITS.htmlBytes+1)}},{body:Buffer.alloc(URL_LIMITS.htmlBytes+1)}])('bounds declared and actual response bytes',async(reply):Promise<void>=>{replies=[reply];await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'TOO_LARGE'});});
  it.each([{headers:{'content-encoding':'gzip'}},{headers:{'content-type':'video/mp4'}},{headers:{'content-type':'application/pdf'},body:Buffer.from('not a PDF')}])('rejects unsupported response',async(reply):Promise<void>=>{replies=[reply];await expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'UNSUPPORTED_TYPE'});});
  it('does not fetch after cancellation',async():Promise<void>=>{const controller=new AbortController();controller.abort();await expect(fetchPublicDocument('https://example.org',controller.signal)).rejects.toMatchObject({reason:'CANCELLED'});expect(mocks.request).not.toHaveBeenCalled();});
  it('bounds stalled DNS with deadline',async():Promise<void>=>{vi.useFakeTimers();try{mocks.lookup.mockReturnValue(new Promise(()=>undefined));const failure=expect(fetchPublicDocument('https://example.org')).rejects.toMatchObject({reason:'TIMEOUT'});await vi.advanceTimersByTimeAsync(URL_LIMITS.milliseconds+1);await failure;}finally{vi.useRealTimers();}});
  it.each(['https://www.bilibili.com/video/a','https://pan.baidu.com/s/a'])('rejects platform pages without downloading %s',(url):void=>{expect(()=>normalizedPublicUrl(url)).toThrow();});
});

describe('streamed video URL network boundary',():void=>{
  const mp4=Buffer.from('000000186674797069736f6d0000020069736f6d','hex');
  async function temporary(check:(file:string)=>Promise<void>):Promise<void>{
    const directory=await mkdtemp(path.join(tmpdir(),'video-fetch-test-')),file=path.join(directory,'download');
    try{await check(file);}finally{await rm(file,{force:true});await rmdir(directory);}
  }
  it('streams MP4 to disk, hashes actual bytes and preserves final URL',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    replies=[{headers:{'content-type':'video/mp4','content-length':String(mp4.length)},body:mp4}];
    const result=await fetchPublicVideo('https://example.org/lesson.mp4',file);
    expect(result).toMatchObject({format:'MP4',fileSize:mp4.length,finalUrl:'https://example.org/lesson.mp4'});
    expect(result.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);expect(await readFile(file)).toEqual(mp4);
    expect(options[0].headers).toMatchObject({Accept:'video/mp4,video/webm','Accept-Encoding':'identity'});
  }));
  it('accepts WebM with a split signature and no declared length',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    const bytes=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(24)]);
    replies=[{headers:{'content-type':'video/webm'},chunks:[bytes.subarray(0,2),bytes.subarray(2,9),bytes.subarray(9)]}];
    expect(await fetchPublicVideo('https://example.org/video',file)).toMatchObject({format:'WEBM',fileSize:28});expect(await readFile(file)).toEqual(bytes);
  }));
  it.each([{headers:{'content-type':'text/html'},body:mp4},{headers:{'content-type':'application/octet-stream'},body:mp4},{headers:{'content-type':'video/mp4'},body:Buffer.from('<html>fake video</html>')},{headers:{'content-type':'video/webm'},body:mp4}])('rejects playback HTML or MIME/signature mismatch',async(reply):Promise<void>=>temporary(async(file):Promise<void>=>{
    replies=[reply];await expect(fetchPublicVideo('https://example.org/video',file)).rejects.toMatchObject({reason:'UNSUPPORTED_TYPE'});
  }));
  it('rejects oversized declared video before writing it',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    replies=[{headers:{'content-type':'video/mp4','content-length':String(VIDEO_URL_LIMITS.bytes+1)},body:mp4}];
    await expect(fetchPublicVideo('https://example.org/video',file)).rejects.toMatchObject({reason:'TOO_LARGE'});await expect(readFile(file)).rejects.toMatchObject({code:'ENOENT'});
  }));
  it('bounds actual streamed bytes without trusting Content-Length',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    function* chunks():Generator<Buffer>{yield mp4;const chunk=Buffer.alloc(1024*1024);for(let i=0;i<101;i++)yield chunk;}
    replies=[{headers:{'content-type':'video/mp4'},chunks:chunks()}];
    await expect(fetchPublicVideo('https://example.org/video',file)).rejects.toMatchObject({reason:'TOO_LARGE'});
  }));
  it('rejects truncated streams',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    replies=[{headers:{'content-type':'video/mp4','content-length':'200'},body:mp4}];await expect(fetchPublicVideo('https://example.org/video',file)).rejects.toMatchObject({reason:'FETCH_FAILED'});
  }));
  it('applies private redirect protection to video as well',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    replies=[{status:302,headers:{location:'http://127.0.0.1/video.mp4'}}];await expect(fetchPublicVideo('https://example.org/video',file)).rejects.toMatchObject({reason:'ADDRESS_BLOCKED'});expect(mocks.request).toHaveBeenCalledTimes(1);
  }));
  it('does not download after cancellation',async():Promise<void>=>temporary(async(file):Promise<void>=>{
    const cancel=new AbortController();cancel.abort();await expect(fetchPublicVideo('https://example.org/video',file,cancel.signal)).rejects.toMatchObject({reason:'CANCELLED'});expect(mocks.request).not.toHaveBeenCalled();
  }));
});
