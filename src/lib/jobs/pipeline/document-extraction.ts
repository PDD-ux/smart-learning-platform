import { z } from 'zod';
import { AiError, chat, type ChatMessage, type ChatOptions } from '@/lib/ai/spark';

/** A fixed line protocol keeps quoted classroom expressions out of JSON strings. */
export function parseDocumentCandidates(text: string): { points: unknown[] } {
  const lines = text.trim().split(/\r?\n/).map((line): string => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 9 || lines.length % 3 !== 0) throw new Error('仅允许1至3组三行：来源、标题、摘要');
  const points: unknown[] = [];
  for (let index = 0; index < lines.length; index += 3) {
    const source = /^来源\s*[:：]\s*(S\d+(?:\s*[,，、]\s*S\d+)*)$/.exec(lines[index]);
    const title = /^标题\s*[:：]\s*(.+)$/.exec(lines[index + 1]);
    const summary = /^摘要\s*[:：]\s*(.+)$/.exec(lines[index + 2]);
    if (!source || !title || !summary) throw new Error('须按来源:S编号、标题:正文、摘要:正文顺序输出，不添加其它行');
    points.push({ sourceIds: source[1].split(/\s*[,，、]\s*/), title: title[1], summary: summary[1] });
  }
  return { points };
}

export function parseDocumentCards(text: string): { cards: unknown[] } {
  const lines = text.trim().split(/\r?\n/).map((line): string => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 24 || lines.length % 3 !== 0) throw new Error('闪卡须按知识点、问题、答案三行格式输出，至多8张');
  const cards: unknown[] = [];
  for (let index = 0; index < lines.length; index += 3) {
    const point = /^知识点\s*[:：]\s*(\d+)$/.exec(lines[index]);
    const front = /^问题\s*[:：]\s*(.+)$/.exec(lines[index + 1]);
    const back = /^答案\s*[:：]\s*(.+)$/.exec(lines[index + 2]);
    if (!point || !front || !back) throw new Error('闪卡必须按知识点:编号、问题:正文、答案:正文顺序输出，不添加其它行');
    cards.push({ pointIndex: Number(point[1]), front: front[1], back: back[1] });
  }
  return { cards };
}

export async function extractDocumentCandidates<T>(messages: ChatMessage[], schema: z.ZodType<T, z.ZodTypeDef, unknown>, options: ChatOptions,
  parser: (text: string) => unknown = parseDocumentCandidates, format = '来源、标题、摘要', lines: 1 | 3 = 3): Promise<{ data: T; attempts: number }> {
  let detail = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await chat(messages, { ...options, jsonMode: false });
    try {
      const parsed = schema.safeParse(parser(result.content));
      if (parsed.success) return { data: parsed.data, attempts: attempt };
      detail = parsed.error.issues.map((issue): string => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 300);
    } catch (error) { detail = error instanceof Error ? error.message : '格式非法'; }
    // Do not echo a malformed candidate as a model-provided example.
    messages = [...messages, { role: 'user', content: `输出未通过校验：${detail}。请重新按${format}${lines === 1 ? '单行' : '三行'}格式输出完整且有实际编号的内容，不要JSON或额外文字。` }];
  }
  throw new AiError(`文档输出两次均未通过校验：${detail}`, 'SCHEMA_INVALID', 502);
}

export async function extractDocumentCards<T>(messages: ChatMessage[], schema: z.ZodType<T, z.ZodTypeDef, unknown>, options: ChatOptions): Promise<{ data: T; attempts: number }> {
  return extractDocumentCandidates(messages, schema, options, parseDocumentCards, '知识点、问题、答案');
}
