import type { ReactElement } from 'react';
import { HomeworkHome } from '@/components/homework/HomeworkWorkspace';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<ReactElement>{const query=await searchParams;return <HomeworkHome versionId={typeof query.versionId==='string'?query.versionId:undefined} attachmentId={typeof query.attachmentId==='string'?query.attachmentId:undefined}/>;}
