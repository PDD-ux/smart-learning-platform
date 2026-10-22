import { z } from 'zod';
import { type ContentRef } from '@/lib/domain/content-ref';

type VideoPoint = { title: string; summary: string; tags: string[]; importance: number; sourceIds: string[]; refs: ContentRef[] };

type Source = { id: string; text: string; ref: ContentRef };
export const VIDEO_SELECTION_PROMPT = '你是课堂重点选择助手。只输出JSON：{"points":[{"sourceIds":["S1"]}]}，精选1至2个可复习的重点。每点选择1至5个本窗连续的真实来源编号，不写标题、摘要、解释或refs。服务器保留相邻上下文和原文。优先具体规则、条件、定义；不要选择玩笑、寒暄、未完成的半句话。资料不足返回{"points":[]}。原文可能含识别错误，不能自行纠正或补写结论。';

/**
 * 从模型给出的编号中修复出一段可用证据：取其中最长的连续段（至多 5 个）。
 * 背景：实测模型（lite / generalv3.5 / 4.0Ultra）经常想摘 6~18 段的长原文，
   或偶尔给出跳跃编号；直接整批拒绝会让 AI 整理反复失败。
 * 硬约束保留：编号必须全部真实存在且无重复，否则视为模型失控，丢弃该点。
 */
function longestConsecutiveRun(rawIds: string[], sources: Source[]): string[] | null {
  if (new Set(rawIds).size !== rawIds.length) return null; // 重复编号 = 模型输出失控
  const indices = rawIds.map((id): number => sources.findIndex((source): boolean => source.id === id));
  if (indices.some((index): boolean => index < 0)) return null; // 未知编号不可修复
  const sorted = [...indices].sort((a, b): number => a - b);
  let bestStart = sorted[0];
  let bestLen = 1;
  let curStart = sorted[0];
  let curLen = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) {
      curLen += 1;
    } else {
      curStart = sorted[i];
      curLen = 1;
    }
    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = curStart;
    }
  }
  const take = Math.min(bestLen, 5);
  return sources.slice(bestStart, bestStart + take).map((source): string => source.id);
}

/** Model selects evidence only. Preserve intervening and neighbouring source text, never model prose. */
export function videoSelectionSchema(sources: Source[]): z.ZodType<{ points: VideoPoint[] }, z.ZodTypeDef, unknown> {
  // 解析层放宽数量上限（编号 30 / 重点 5），转换层修复到 2 点 × 最长连续 5 编号：
  // 见 longestConsecutiveRun 注释——实测各档模型都会超量，整批拒绝会让整理几乎必失败。
  return z.object({ points: z.array(z.object({ sourceIds: z.array(z.string()).min(1).max(30) }).strict()).max(5) }).strict()
    .transform((data, validation): { points: VideoPoint[] } => {
      const points: VideoPoint[] = [];
      const used = new Set<string>();
      for (const raw of data.points.slice(0, 2)) {
        const repaired = longestConsecutiveRun(raw.sourceIds, sources);
        if (!repaired) {
          validation.addIssue({ code: z.ZodIssueCode.custom, message: '仅可选择不重复的本窗真实来源编号。' });
          continue;
        }
        const indices = repaired.map((id): number => sources.findIndex((source): boolean => source.id === id));
        const selected = sources.slice(Math.max(0, Math.min(...indices) - 1), Math.min(sources.length, Math.max(...indices) + 2));
        const summary = selected.map((source): string => source.text).join('\n');
        const key = selected.map((source): string => source.id).join(',');
        if (summary.trim().length < 12 || summary.length > 1000) {
          validation.addIssue({ code: z.ZodIssueCode.custom, message: '完整上下文须为12至1000字，不能截断后保存。' });
          continue;
        }
        if (used.has(key)) continue;
        used.add(key);
        const timestamp = selected[0].ref.type === 'video' ? selected[0].ref.timestampSec : 0;
        points.push({ title: `原文精选 · ${Math.floor(timestamp / 60)}:${String(timestamp % 60).padStart(2, '0')}`,
          summary, tags: ['原文精选', '转写或OCR待核对'], importance: 3,
          sourceIds: selected.map((source): string => source.id), refs: selected.map((source): ContentRef => source.ref) });
      }
      return { points };
    });
}
