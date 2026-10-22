import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { api,clearAccessToken } from '@/services/api';
import { reportCreate,reportHandle,threadModeration,replyModeration,courseDiscussion } from '@/lib/discussions/moderation-contracts';
const fetchMock=vi.fn();
beforeEach(():void=>{clearAccessToken();vi.stubGlobal('fetch',fetchMock);fetchMock.mockImplementation(():Promise<Response>=>Promise.resolve(new Response(JSON.stringify({success:true,data:{},message:'ok',timestamp:new Date().toISOString()}),{status:200,headers:{'content-type':'application/json'}})));});
afterEach(():void=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const id='550e8400-e29b-41d4-a716-446655440000';
it('serializes report creation exactly once to an object accepted by the server',async():Promise<void>=>{await api.reportDiscussion(id,'课堂原因',id,id);const wire:unknown=JSON.parse(fetchMock.mock.calls[0][1].body as string);expect(reportCreate.safeParse(wire).success).toBe(true);});
it('serializes all moderation actions exactly once and preserves versions',async():Promise<void>=>{await api.moderateDiscussion(id,1,'hide','管理理由');await api.moderateReply(id,2,'restore','恢复理由');await api.setCourseDiscussion(id,3,false,'关闭原因');await api.handleDiscussionReport(id,4,'已完成核对');const schemas=[threadModeration,replyModeration,courseDiscussion,reportHandle];schemas.forEach((schema,index):void=>{const wire:unknown=JSON.parse(fetchMock.mock.calls[index][1].body as string);expect(schema.safeParse(wire).success).toBe(true);expect(typeof wire).toBe('object');});});
