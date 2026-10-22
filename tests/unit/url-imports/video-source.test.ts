import { beforeEach, expect, it, vi } from 'vitest';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
const mocks=vi.hoisted(()=>({download:vi.fn(),probe:vi.fn(),put:vi.fn()}));
vi.mock('@/lib/url-imports/fetch',async(importOriginal)=>({...await importOriginal<object>(),fetchPublicVideo:mocks.download}));
vi.mock('@/lib/media/ffmpeg-runner',()=>({runText:mocks.probe}));
vi.mock('@/lib/storage',()=>({getStorage:()=>({putObject:mocks.put})}));
import { downloadVideoSnapshot } from '@/lib/video-imports/source';
let capturedPath:string;
beforeEach(():void=>{
  vi.clearAllMocks();capturedPath='';
  mocks.download.mockImplementation(async(_url:string,file:string):Promise<object>=>{capturedPath=file;await writeFile(file,Buffer.from('validated-video-bytes'));return{format:'MP4',fileSize:21,sourceDigest:'a'.repeat(64),finalUrl:'https://cdn.example.org/lesson.mp4',contentType:'video/mp4',fetchedAt:'2026-10-21T00:00:00Z'};});
  mocks.probe.mockResolvedValue(JSON.stringify({format:{duration:'32.2'},streams:[{codec_type:'video',codec_name:'h264',width:640,height:360}]}));
  mocks.put.mockImplementation(async(_key:string,stream:Readable):Promise<void>=>{for await(const _chunk of stream){void _chunk;}});
});
it('validates local media before streaming a source with immutable attribution metadata',async():Promise<void>=>{
  const result=await downloadVideoSnapshot('https://example.org/start','draft-one',new AbortController().signal);
  expect(result).toMatchObject({format:'MP4',fileSize:21,durationSec:33,storageKey:'contents/url-draft-one/source.mp4',source:{requestedUrl:'https://example.org/start',finalUrl:'https://cdn.example.org/lesson.mp4',author:null,contentDigest:'a'.repeat(64)}});
  expect(mocks.probe.mock.calls[0][1]).toContain('file,pipe');expect(mocks.put).toHaveBeenCalledTimes(1);await expect(access(path.dirname(capturedPath))).rejects.toMatchObject({code:'ENOENT'});
});
it.each([{format:{duration:'7201'},streams:[{codec_type:'video',codec_name:'h264',width:640,height:360}]},{format:{duration:'0'},streams:[{codec_type:'video',codec_name:'h264',width:640,height:360}]},{format:{duration:'30'},streams:[{codec_type:'audio',codec_name:'aac'}]},{format:{duration:'30'},streams:[{codec_type:'video',codec_name:'hevc',width:640,height:360}]}])('rejects unplayable, audio-only or oversized duration before storage',async(probe):Promise<void>=>{
  mocks.probe.mockResolvedValue(JSON.stringify(probe));await expect(downloadVideoSnapshot('https://example.org/video','draft-two',new AbortController().signal)).rejects.toMatchObject({reason:'CONTENT_UNREADABLE'});expect(mocks.put).not.toHaveBeenCalled();await expect(access(path.dirname(capturedPath))).rejects.toMatchObject({code:'ENOENT'});
});
it('fails clearly and removes temporary files when ffprobe is missing',async():Promise<void>=>{mocks.probe.mockRejectedValue(new Error('ENOENT'));await expect(downloadVideoSnapshot('https://example.org/video','draft-three',new AbortController().signal)).rejects.toMatchObject({reason:'CONTENT_UNREADABLE'});expect(mocks.put).not.toHaveBeenCalled();await expect(access(path.dirname(capturedPath))).rejects.toThrow();});
it('cleans local data after a storage stream failure',async():Promise<void>=>{mocks.put.mockImplementation(async(_key:string,stream:Readable):Promise<void>=>{stream.destroy();throw new Error('storage unavailable');});await expect(downloadVideoSnapshot('https://example.org/video','draft-four',new AbortController().signal)).rejects.toThrow('storage unavailable');await expect(access(path.dirname(capturedPath))).rejects.toThrow();});
