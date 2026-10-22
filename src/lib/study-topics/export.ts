import {prisma} from '@/lib/prisma';
import {courseAccount} from '@/lib/courses/service';
import type {AuthUser} from '@/lib/auth/middleware';
import {ApiError} from '@/lib/auth/ownership';
import {ErrorCode} from '@/lib/api/errors';
import type {BookState} from '@/lib/books/contracts';
import {topicLink,citationLabel,type TopicData} from './contracts';
export async function exportTopic(id:string,user:AuthUser,format:'md'|'txt'):Promise<{text:string;fileName:string}>{
 await courseAccount(user);const row=await prisma.studyTopic.findFirst({where:{id,ownerId:user.id}});if(!row)throw new ApiError(ErrorCode.NOT_FOUND,'专题不存在');const value=row.data as unknown as TopicData;
 const lines=[`# ${row.title}`,`私人专题历史快照 · 导出时间 ${new Date().toISOString()}`,`来源数 ${value.sources.length}；问答记录 ${value.answers.length}。仅涵盖已保存引用，不代表全文覆盖或当前源仍有效。`,'AI原文依据答复，非综合推理；可能有遗漏。',...value.sources.map((scope):string=>`资料 ${scope.contentId}：${scope.mode==='parsed'?'已解析范围':`${scope.start}–${scope.end}（实际页/段或秒）`}`)];
 for(const answer of value.answers){lines.push('',`## 问题：${answer.question}`,`状态 ${answer.state} · ${answer.createdAt}`,answer.reason??'');for(const c of answer.coverage)lines.push(`来源 ${c.title}（${c.contentId}）· ${c.readable}/${c.total??'未知总量'}可用单元 · 版本 ${c.version}${c.pasteSource?` · 本人提供（未经原站核验）：${c.pasteSource.label}；作者${c.pasteSource.author??'未提供'}`:''}`);for(const c of answer.citations)lines.push(`原文：${c.quote}`,`出处 ${c.title} · ${citationLabel(c)} · 字符偏移${c.offset} · 版本${c.version}`,topicLink(c));}
 lines.push('','## 当前专题来源的章节摘录与本人批注','以下为导出时的独立笔记；不作为以上AI答复的依据，含本人的未移除记录。');
 for(const scope of value.sources){const content=await prisma.learningContent.findFirst({where:{id:scope.contentId,ownerId:user.id,status:'READY'},select:{title:true,bookState:true}});if(!content){lines.push(`资料 ${scope.contentId} 当前不可用，历史引用仍为当时快照。`);continue;}const book=content.bookState as unknown as BookState|null;if(book?.pastedSource)lines.push(`本人提供（未经原站核验）：${book.pastedSource.label}；作者${book.pastedSource.author??'未提供'}；快照${book.pastedSource.bodyDigest}`);const entries=book?.readingJournal?.entries.filter((e):boolean=>!e.removed&&e.state==='READY'&&(scope.mode==='parsed'||(e.start>=scope.start&&e.end<=scope.end)))??[];for(const e of entries){lines.push(`### ${content.title} · ${e.kind==='AI'?'AI精选原文':'本人摘录'} · ${e.start}–${e.end}${e.unitKind==='page'?'页':'段'} · 源SHA ${e.sourceDigest}`,...e.points.map((p):string=>`原文（${p.position}，偏移${p.start}–${p.end}）：${p.quote}`),`本人批注：${e.annotation}`,`标签：${e.tags.join('、')}`);}}
 const text=lines.join('\n');if(Buffer.byteLength(text)>2*1024*1024)throw new ApiError(ErrorCode.VALIDATION_FAILED,'本次导出超过2MiB，请分别导出各来源笔记');await prisma.auditLog.create({data:{actorId:user.id,action:'study-topic.export',objectId:id,result:'success',detail:JSON.stringify({format,answers:value.answers.length,sources:value.sources.length})}});return{text,fileName:`study-topic-${id}.${format}`};
}
