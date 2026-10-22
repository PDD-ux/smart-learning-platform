import type { ReactElement } from 'react';
import { HomeworkDetail } from '@/components/homework/HomeworkWorkspace';
export default async function Page({params}:{params:Promise<{id:string}>}):Promise<ReactElement>{return <HomeworkDetail id={(await params).id}/>;}
