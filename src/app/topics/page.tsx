import type {ReactElement} from 'react';
import {TopicWorkspace} from '@/components/topics/TopicWorkspace';
export default async function TopicsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<ReactElement>{const query=await searchParams;return <TopicWorkspace initialContent={typeof query.contentId==='string'?query.contentId:''} initialStart={typeof query.start==='string'?query.start:''} initialEnd={typeof query.end==='string'?query.end:''}/>;}
