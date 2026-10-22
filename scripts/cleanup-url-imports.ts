import {loadEnvConfig}from'@next/env';
async function main():Promise<void>{loadEnvConfig(process.cwd(),false);const{expireUrlDrafts}=await import('../src/lib/url-imports/service');const{prisma}=await import('../src/lib/prisma');try{const expired=await expireUrlDrafts();console.log(JSON.stringify({expired,limit:100,scheduled:false}));}finally{await prisma.$disconnect();}}
void main().catch(():void=>{console.error('链接预览维护未完成；未输出私有异常。');process.exitCode=1;});
