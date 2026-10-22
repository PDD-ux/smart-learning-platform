import { z } from 'zod';
import { checkContent } from '@/lib/ai/content-guard';
import { playbackTimeLabel } from '@/lib/domain/playback-notes';

export type ExtractSource = { text: string; startMs: number; endMs: number };
export type ExtractSelection = { points: Array<{ sourceNumbers: number[] }> };

function contextRange(numbers: number[], length: number): { first: number; last: number } {
  return { first: Math.max(0, Math.min(...numbers) - 1), last: Math.min(length - 1, Math.max(...numbers) + 1) };
}

export function watchedExtractMarkdown(selection: ExtractSelection, sources: ExtractSource[]): string {
  return selection.points.map((point, index): string => {
    const range = contextRange(point.sourceNumbers, sources.length);
    const context = sources.slice(range.first, range.last + 1);
    return `### 原文要点 ${index + 1}\n\n原文摘录：\n${context.map((source): string => source.text).join('\n')}\n\n来源：${context.map((source): string => playbackTimeLabel(source.startMs / 1000)).join('、')}`;
  }).join('\n\n');
}

export function watchedExtractSchema(sources: ExtractSource[]): z.ZodType<ExtractSelection> {
  const point = z.object({ sourceNumbers: z.array(z.number().int().min(0).max(sources.length - 1)).min(1).max(12) }).strict();
  return z.object({ points: z.array(point).min(1).max(3) }).strict().superRefine((selection, validation): void => {
    if (selection.points.some((item): boolean => item.sourceNumbers.some((number): boolean => !Number.isInteger(number) || number < 0 || number >= sources.length))) {
      validation.addIssue({ code: z.ZodIssueCode.custom, message: '只允许实际原文编号' }); return;
    }
    const markdown = watchedExtractMarkdown(selection, sources);
    if (markdown.length > 4500 || !checkContent(markdown).safe) validation.addIssue({ code: z.ZodIssueCode.custom, message: '摘录过长或未通过安全检查' });
  });
}
