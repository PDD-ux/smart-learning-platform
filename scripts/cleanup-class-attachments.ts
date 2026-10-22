import { loadEnvConfig } from '@next/env';
import { cleanupAssignmentAttachments } from '../src/lib/classrooms/attachments';
import { classId } from '../src/lib/classrooms/contracts';
import { prisma } from '../src/lib/prisma';
loadEnvConfig(process.cwd());
async function main(): Promise<void> { try { const cursorOption=process.argv.find((value):boolean=>value.startsWith('--cursor='));let cursor=cursorOption?.slice('--cursor='.length);if(cursor&&!classId.safeParse(cursor).success)throw Error('invalid cursor'); let processed=0,deleted=0,failed=0; for(let batch=0;batch<10;batch++){const result=await cleanupAssignmentAttachments(prisma,undefined,new Date(),cursor);processed+=result.processed;deleted+=result.deleted;failed+=result.failed;cursor=result.nextCursor??undefined;if(!cursor)break;}console.log(JSON.stringify({processed,deleted,failed,nextCursor:cursor??null})); } finally { await prisma.$disconnect(); } }
main().catch(():void=>{console.error('作业过期附件清理未完成，请检查本机存储/数据库状态。');process.exitCode=1;});


