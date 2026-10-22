import path from 'node:path';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { validateAssignmentFile } from '@/lib/classrooms/attachment-format';
import { attachmentSchema } from '@/lib/classrooms/rules';
import { getInferenceGateway } from '@/lib/ai/gateway';
import { recognizeByVisionModel, VISION_OCR_LOW_CONFIDENCE } from '@/lib/ai/vision-ocr';
import { FILE_LIMIT } from './contracts';
export type ExtractedHomework={text:string;issues:string[];method:'text-layer'|'ocr'};
function invalid(message:string):never{throw new ApiError(ErrorCode.VALIDATION_FAILED,message);}
export function boundedText(text:string):string{if(text.length>50000)invalid('提取文字超过50000字，请自行拆分后重新导入；未截断保存');return text;}
export async function extractHomeworkFile(bytes:Buffer,fileName:string,mimeType:string):Promise<ExtractedHomework>{
 if(bytes.length>FILE_LIMIT||!attachmentSchema.safeParse({fileName,mimeType,sizeBytes:bytes.length}).success)invalid('识别文件仅支持4MiB以内的TXT/MD/PDF/PNG/JPEG，扩展名与格式须一致');
 await validateAssignmentFile(bytes,mimeType);
 if(mimeType.startsWith('text/'))return{text:boundedText(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/u,'')),issues:['请逐题核对题号、题目和作答对应关系；系统没有自动推断答案。'],method:'text-layer'};
 if(mimeType==='application/pdf'){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const root=path.resolve('node_modules/pdfjs-dist');
  const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,cMapUrl:root+'/cmaps/',cMapPacked:true,standardFontDataUrl:root+'/standard_fonts/'});
  try{const pdf=await loading.promise;if(pdf.numPages>20)invalid('本次作业识别最多20页，请拆分后导入；未只取前20页');let text='';const missing:number[]=[];
   for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){const page=await pdf.getPage(pageNo);const content=await page.getTextContent();let part='';for(const item of content.items)if('str'in item)part=boundedText(part+item.str+(item.hasEOL?'\n':' '));if(!part.trim())missing.push(pageNo);text=boundedText(text+`\n[第${pageNo}页]\n`+part.trim());page.cleanup();}
   return{text:text.trim(),issues:['PDF仅提取文字层，公式、表格顺序和答案对应须人工核对。',...(missing.length?[`第${missing.join('、')}页没有可读文字层，请对照原件补录；本次没有执行扫描PDF OCR。`]:[])],method:'text-layer'};
  }finally{await loading.destroy();}
 }
 const gateway=getInferenceGateway();let fallback=false;const encoded=bytes.toString('base64');
 try{
  const health=await gateway.health({timeoutMs:5000});if(health.mock)throw Error('mock');
  const result=await gateway.detectText([{frameIndex:0,imageBase64:encoded}],{timeoutMs:30000,onFallback:():void=>{fallback=true;}});
  const blocks=result.items.flatMap((item):typeof item.blocks=>item.blocks).filter((b):boolean=>!!b.text.trim());
  // 本地引擎（RapidOCR/PP-OCRv4）结果不足以采信时，交给云端视觉大模型重认一遍。
  const scores=blocks.map((b):number=>Number.isFinite(b.confidence)?b.confidence:0);
  const average=scores.length?scores.reduce((sum,value):number=>sum+value,0)/scores.length:0;
  const unreliable=!blocks.length||average<VISION_OCR_LOW_CONFIDENCE||scores.some((value):boolean=>value<VISION_OCR_LOW_CONFIDENCE);
  if(unreliable){const vision=await recognizeByVisionModel(encoded,mimeType);if(vision)return{text:boundedText(vision.text),method:'ocr',issues:[`本地OCR未达到可信阈值（平均置信${average.toFixed(2)}），已改用云端视觉模型「${vision.model}」重认。`,'云端转录同样可能遗漏手写、公式与模糊处，请逐题对照原件。']};}
  if(fallback||!blocks.length)throw Error('empty');
  const text=boundedText(blocks.map((b):string=>b.text).join('\n'));
  return{text,method:'ocr',issues:['图片OCR可能遗漏题号、符号或手写内容，请逐题对照原件。',...(scores.some((value):boolean=>value<VISION_OCR_LOW_CONFIDENCE)?['存在低置信文字（小于0.85或未知），必须人工校对；复杂公式未保证支持。']:[])]};
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(ErrorCode.STORAGE_UNAVAILABLE,'图片OCR当前不可用、处于模拟模式或未识别到文字。未计识别成功；可对照原图手动补录题目和答案。');}
}
