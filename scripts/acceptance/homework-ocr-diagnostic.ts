import { loadEnvConfig } from '@next/env';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import sharp from 'sharp';
import { getInferenceGateway } from '../../src/lib/ai/gateway';
import { extractHomeworkFile } from '../../src/lib/homework/extract';
loadEnvConfig(process.cwd(),true,{info:():void=>undefined,error:():void=>undefined});Object.assign(process.env,parseEnv(readFileSync('.env.local','utf8')));
const root='.taskbook-working/homework-recognition-20261019';mkdirSync(root,{recursive:true});
async function main():Promise<void>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="360"><rect width="1000" height="360" fill="white"/><g font-family="Microsoft YaHei, sans-serif" font-size="38" fill="black"><text x="35" y="75">1. 什么是函数？</text><text x="35" y="145">我的答案：每个自变量都有唯一对应值。</text><text x="35" y="215">参考答案：每个自变量都有唯一对应值。</text><text x="35" y="285">评分依据：课堂函数定义。</text></g></svg>';
 const bytes=await sharp(Buffer.from(svg)).png().toBuffer();writeFileSync(root+'/ocr-original.png',bytes);
 let health:Record<string,unknown>={};try{const value=await getInferenceGateway().health({timeoutMs:5000});health={status:value.status,mock:value.mock,modelsLoaded:value.modelsLoaded,device:value.device};const result=await extractHomeworkFile(bytes,'原创作业.png','image/png');const recognized=result.text.includes('函数')&&result.text.includes('唯一');writeFileSync(root+'/ocr-diagnostic.json',JSON.stringify({state:recognized?'PASSED':'QUALITY_FAILED',health,realOcr:true,recognizedText:result.text,issues:result.issues,configuredUrl:!!process.env.ASCEND_INFER_URL,modelApiCalled:false},null,2));console.log(recognized?'Real original OCR sample passed':'Real OCR returned text but expected original terms missing');}
 catch(error){writeFileSync(root+'/ocr-diagnostic.json',JSON.stringify({state:'BLOCKED',health,errorType:error instanceof Error?error.name:'unknown',errorCode:error&&typeof error==='object'&&'code'in error?error.code:'unknown',httpStatus:error&&typeof error==='object'&&'status'in error?error.status:null,configuredUrl:!!process.env.ASCEND_INFER_URL,modelApiCalled:false,reason:'现有推理服务健康检查或真实图片提取未通过；未启动云资源/改配置，不能把mock当真实OCR。',reproduce:'npx tsx scripts/acceptance/homework-ocr-diagnostic.ts'},null,2));console.log('Real OCR blocked; reproducible diagnostic saved without credentials.');}
}
main().catch(():void=>{console.error('Original OCR diagnostic preparation failed.');process.exitCode=1;});
