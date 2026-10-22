import { apiRequest } from './api';
import { FILE_LIMIT, type CreateHomework, type HomeworkCommand, type HomeworkView, type HomeworkList } from '@/lib/homework/contracts';
import type { HomeworkGradingReport, HomeworkMistakeList, ReportCommand, ReportCreateInput } from '@/lib/homework/grading-contracts';
export const homework={
 list:(page=1):Promise<HomeworkList>=>apiRequest('/api/homework?page='+page),
 read:(id:string):Promise<HomeworkView>=>apiRequest('/api/homework/'+encodeURIComponent(id)),
 create:(input:CreateHomework):Promise<HomeworkView>=>apiRequest('/api/homework',{method:'POST',body:input}),
 command:(id:string,input:HomeworkCommand):Promise<HomeworkView>=>apiRequest('/api/homework/'+encodeURIComponent(id),{method:'POST',body:input}),
 grading:(id:string):Promise<{items:HomeworkGradingReport[]}>=>apiRequest('/api/homework/'+encodeURIComponent(id)+'/grading'),
 createGrading:(id:string,input:ReportCreateInput):Promise<HomeworkGradingReport>=>apiRequest('/api/homework/'+encodeURIComponent(id)+'/grading',{method:'POST',body:input}),
 runGrading:(id:string,reportId:string):Promise<HomeworkGradingReport>=>apiRequest('/api/homework/'+encodeURIComponent(id)+'/grading/'+encodeURIComponent(reportId)+'/run',{method:'POST',signal:AbortSignal.timeout(125_000)}),
 commandGrading:(id:string,reportId:string,input:ReportCommand):Promise<HomeworkGradingReport>=>apiRequest('/api/homework/'+encodeURIComponent(id)+'/grading/'+encodeURIComponent(reportId),{method:'POST',body:input,signal:input.action==='correct'?AbortSignal.timeout(125_000):undefined}),
 mistakes:():Promise<HomeworkMistakeList>=>apiRequest('/api/homework/mistakes'),
};
export async function homeworkFileSource(file:File):Promise<Extract<CreateHomework['source'],{kind:'file'}>>{
 if(file.size>FILE_LIMIT)throw Error('识别文件最多4MiB，请自行拆分后选择');
 const types:Record<string,string>={txt:'text/plain',md:'text/markdown',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};const mimeType=types[file.name.split('.').at(-1)?.toLowerCase()??''];
 if(!mimeType)throw Error('只支持TXT/MD/PDF/PNG/JPEG');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
 return{kind:'file',fileName:file.name,mimeType:mimeType as Extract<CreateHomework['source'],{kind:'file'}>['mimeType'],base64:btoa(binary)};
}
