import { z } from 'zod';
import { examQuestionTypeSchema } from './contracts';
import type { BankItem } from './bank-contracts';

const id = z.string().trim().min(1).max(128);
export const paperPlanSchema = z.object({
  mode: z.literal('BANK'), title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).default(''), subjectId: id,
  chapterIds: z.array(id).max(50).default([]), durationSec: z.number().int().min(60).max(21600),
  sections: z.array(z.object({ key: id, title: z.string().trim().min(1).max(100), type: examQuestionTypeSchema, questionCount: z.number().int().min(1).max(200), scorePerQuestionUnits: z.number().int().min(1).max(1000000), difficultyMin: z.number().int().min(1).max(5), difficultyMax: z.number().int().min(1).max(5) }).strict()).min(1).max(20),
}).strict().superRefine((plan, context): void => {
  if (new Set(plan.chapterIds).size !== plan.chapterIds.length || new Set(plan.sections.map((section): string => section.key)).size !== plan.sections.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '章节或分区编号重复' });
  if (plan.sections.some((section): boolean => section.difficultyMin > section.difficultyMax)) context.addIssue({ code: z.ZodIssueCode.custom, message: '难度范围无效' });
  if (plan.sections.reduce((sum, section): number => sum + section.questionCount, 0) > 200 || plan.sections.reduce((sum, section): number => sum + section.questionCount * section.scorePerQuestionUnits, 0) > 1000000) context.addIssue({ code: z.ZodIssueCode.custom, message: '超过200题或10000分上限' });
});
export type PaperPlan = z.infer<typeof paperPlanSchema>;
export const paperSelectionsSchema = z.array(z.object({ key: id, questionVersionIds: z.array(id).max(200) }).strict()).min(1).max(20);
export type PaperSelections = z.infer<typeof paperSelectionsSchema>;
const prepared = { plan: paperPlanSchema, selections: paperSelectionsSchema, previewDigest: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid(), confirmed: z.literal(true) };
export const paperCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), plan: paperPlanSchema, selections: paperSelectionsSchema.optional() }).strict(),
  z.object({ action: z.literal('paper.create'), ...prepared }).strict(),
  z.object({ action: z.literal('paper.revise'), ...prepared, id, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('paper.publish'), id, versionId: id, expectedRevision: z.number().int().positive(), requestId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('paper.withdraw'), id, expectedRevision: z.number().int().positive(), requestId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
]);
export type PaperCommand = z.input<typeof paperCommandSchema>;
export type PaperCandidate = BankItem & { id: string; questionId: string; chapterId: string | null };
export type PaperPreview = {
  plan: PaperPlan; selections: PaperSelections; complete: boolean; digest: string | null; questionCount: number; totalScoreUnits: number;
  sections: { key: string; required: number; available: number; missing: number; items: PaperCandidate[] }[];
};
export type AdminPaperSummary = { id: string; subjectId: string; state: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'; revision: number; latestVersionNo: number; title: string; questionCount: number; totalScoreUnits: number; durationSec: number; publishedVersionId: string | null };
export type AdminPaperVersion = { id: string; versionNo: number; sealedAt: string; plan: PaperPlan; selections: PaperSelections; questionCount: number; totalScoreUnits: number; sections: { key: string; items: PaperCandidate[] }[] };
export type AdminPaper = AdminPaperSummary & { versions: AdminPaperVersion[] };

export function stemKey(stem: string): string { return stem.normalize('NFKC').replace(/\s/gu, '').toLocaleLowerCase(); }
function fits(candidate: PaperCandidate, section: PaperPlan['sections'][number]): boolean { return candidate.body.type === section.type && candidate.difficulty >= section.difficultyMin && candidate.difficulty <= section.difficultyMax; }

/** Maximum bipartite matching prevents wide quotas stealing all narrow-quota questions. */
export function selectPaper(plan: PaperPlan, candidates: PaperCandidate[], manual?: PaperSelections): Omit<PaperPreview, 'digest'> {
  const groups = new Map<string, PaperCandidate[]>();
  for (const candidate of candidates) { const key = stemKey(candidate.body.stem); const group = groups.get(key); if (group) group.push(candidate); else groups.set(key, [candidate]); }
  let selections: PaperSelections;
  if (manual) {
    if (manual.length !== plan.sections.length || manual.some((row, index): boolean => row.key !== plan.sections[index].key || row.questionVersionIds.length !== plan.sections[index].questionCount)) throw new Error('手动选题须保持每个分区的完整题量与顺序');
    selections = manual;
  } else {
    const pool = [...groups.values()], slots = plan.sections.flatMap((section, sectionIndex): number[] => Array.from({ length: section.questionCount }, (): number => sectionIndex));
    const edges = plan.sections.map((section): number[] => pool.flatMap((group, index): number[] => group.some((candidate): boolean => fits(candidate, section)) ? [index] : []));
    const assigned = new Map<number, number>();
    const place = (slot: number, visited: Set<number>): boolean => {
      for (const group of edges[slots[slot]]) { if (visited.has(group)) continue; visited.add(group); const previous = assigned.get(group); if (previous === undefined || place(previous, visited)) { assigned.set(group, slot); return true; } } return false;
    };
    slots.forEach((_section, slot): void => { place(slot, new Set()); });
    selections = plan.sections.map((section, index): PaperSelections[number] => ({ key: section.key, questionVersionIds: [...assigned].filter(([_group, slot]): boolean => slots[slot] === index).sort((a, b): number => a[1] - b[1]).map(([group]): string => pool[group].find((candidate): boolean => fits(candidate, section))!.id) }));
  }
  const usedIds = new Set<string>(), usedStems = new Set<string>(), usedQuestions = new Set<string>();
  const sections = plan.sections.map((section, index): PaperPreview['sections'][number] => {
    const selected = selections[index].questionVersionIds.map((value): PaperCandidate => {
      const candidate = candidates.find((entry): boolean => entry.id === value);
      if (!candidate || !fits(candidate, section) || usedIds.has(value) || usedQuestions.has(candidate.questionId) || usedStems.has(stemKey(candidate.body.stem))) throw new Error('选题已失效、重复或不符合当前分区范围，请重新预览');
      usedIds.add(value); usedQuestions.add(candidate.questionId); usedStems.add(stemKey(candidate.body.stem)); return candidate;
    });
    return { key: section.key, required: section.questionCount, available: [...groups.values()].filter((group): boolean => group.some((candidate): boolean => fits(candidate, section))).length, missing: section.questionCount - selected.length, items: selected };
  });
  return { plan, selections, sections, complete: sections.every((section): boolean => section.missing === 0), questionCount: sections.reduce((sum, section): number => sum + section.items.length, 0), totalScoreUnits: sections.reduce((sum, section, index): number => sum + section.items.length * plan.sections[index].scorePerQuestionUnits, 0) };
}
