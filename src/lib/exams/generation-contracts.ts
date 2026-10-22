import { z } from 'zod';
import { examBlueprintSchema, examSourceSchema, questionBodySchema } from './contracts';
import { contentRefSchema } from '@/lib/domain/content-ref';
import { checkContent } from '@/lib/ai/content-guard';

export const generationPlanSchema = z.object({ blueprint: examBlueprintSchema, scope: z.string().trim().min(1).max(1000), difficultyMin: z.number().int().min(1).max(5), difficultyMax: z.number().int().min(1).max(5) }).strict().superRefine((plan, ctx): void => {
  if (plan.blueprint.requestedCount > 50 || plan.difficultyMin > plan.difficultyMax || !checkContent(plan.scope).safe) ctx.addIssue({ code: 'custom', message: '题量、难度范围或出题范围无效' });
});
export type GenerationPlan = z.infer<typeof generationPlanSchema>;
export const generationCreateSchema = z.object({ plan: generationPlanSchema, requestId: z.string().uuid(), confirmed: z.literal(true) }).strict();
export const generationActionSchema = z.object({ action: z.enum(['retry', 'cancel']), expectedRevision: z.number().int().min(0).max(2147483646), requestId: z.string().uuid() }).strict();
const evidenceSchema = z.object({ id: z.string().min(1).max(128), text: z.string().min(1).max(12000), ref: contentRefSchema }).strict();
export const generationSnapshotSchema = z.object({ plan: generationPlanSchema, subjectName: z.string(), sources: z.array(evidenceSchema).max(24), evidenceTruncated: z.boolean(), sourceDigest: z.string() }).strict();
export type GenerationSnapshot = z.infer<typeof generationSnapshotSchema>;
export type GenerationSlot = { position: number; sectionKey: string; type: GenerationPlan['blueprint']['sections'][number]['type']; scoreUnits: number };
export const draftCandidateSchema = z.object({ position: z.number().int().min(0).max(49), sectionKey: z.string(), body: questionBodySchema, difficulty: z.number().int().min(1).max(5), source: examSourceSchema, questionVersionId: z.string().nullable(), evidence: z.array(z.object({ id: z.string(), quote: z.string(), ref: contentRefSchema }).strict()).max(4) }).strict();
export type DraftCandidate = z.infer<typeof draftCandidateSchema>;
export type GenerationStatus = { jobId: string; state: 'QUEUED' | 'RUNNING' | 'INCOMPLETE' | 'READY' | 'FAILED' | 'CANCELLED'; revision: number; mode: GenerationPlan['blueprint']['mode']; requestedCount: number; acceptedCount: number; rejectedCount: number; missingCount: number; callBudget: number; usedCalls: number; remainingCalls: number; failureCode: string | null; createdAt: string; deadlineAt: string; finishedAt: string | null; needsRecovery: boolean; evidenceTruncated: boolean };
export function generationSlots(plan: GenerationPlan): GenerationSlot[] {
  let position = 0;
  return plan.blueprint.sections.flatMap((section): GenerationSlot[] => Array.from({ length: section.questionCount }, (): GenerationSlot => ({ position: position++, sectionKey: section.key, type: section.type, scoreUnits: section.scorePerQuestionUnits })));
}
function normalized(text: string): string { return text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); }
export function repeatedStem(stem: string, previous: string[]): boolean {
  const key = normalized(stem), grams = (value: string): Set<string> => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index): string => value.slice(index, index + 2)));
  return previous.some((old): boolean => { const other = normalized(old); if (key === other) return true; if (Math.min(key.length, other.length) < 8) return false; const a = grams(key), b = grams(other), intersection = [...a].filter((value): boolean => b.has(value)).length; return intersection / new Set([...a, ...b]).size >= 0.9; });
}
const proposedSchema = z.object({ questions: z.array(z.object({ position: z.number().int().min(0).max(49), body: questionBodySchema, difficulty: z.number().int().min(1).max(5), evidence: z.array(z.object({ id: z.string(), quote: z.string().trim().min(8).max(500) }).strict()).max(4).default([]) }).strict()).max(5) }).strict();
export function acceptGenerationCandidates(raw: string, slots: GenerationSlot[], existing: DraftCandidate[], snapshot: GenerationSnapshot): { accepted: DraftCandidate[]; rejected: number; failureCode: 'INVALID_JSON' | 'QUALITY_REJECTED' | 'INSUFFICIENT_EVIDENCE' | null } {
  let value: unknown;
  try { if (raw.length > 40000) throw new Error('bound'); value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')) as unknown; } catch { return { accepted: [], rejected: slots.length, failureCode: 'INVALID_JSON' }; }
  const parsed = proposedSchema.safeParse(value); if (!parsed.success) return { accepted: [], rejected: slots.length, failureCode: 'QUALITY_REJECTED' };
  const accepted: DraftCandidate[] = [], prior = existing.map((item): string => item.body.stem);
  for (const item of parsed.data.questions) {
    const slot = slots.find((row): boolean => row.position === item.position);
    if (!slot || parsed.data.questions.filter((row): boolean => row.position === item.position).length !== 1 || slot.type !== item.body.type || item.difficulty < snapshot.plan.difficultyMin || item.difficulty > snapshot.plan.difficultyMax || item.body.stem.length < 8 || item.body.explanation.trim().length < 8 || !checkContent(JSON.stringify(item)).safe || repeatedStem(item.body.stem, prior) || /官方真题|来源[:：]|https?:\/\//u.test(JSON.stringify(item.body))) continue;
    const evidence: DraftCandidate['evidence'] = [];
    if (snapshot.plan.blueprint.mode === 'AI_SOURCE') {
      if (!item.evidence.length || new Set(item.evidence.map((entry): string => entry.id)).size !== item.evidence.length) continue;
      for (const citation of item.evidence) { const source = snapshot.sources.find((row): boolean => row.id === citation.id); if (source && source.text.includes(citation.quote)) evidence.push({ id: source.id, quote: citation.quote, ref: source.ref }); }
      if (evidence.length !== item.evidence.length) continue;
    } else if (item.evidence.length) continue;
    accepted.push({ position: slot.position, sectionKey: slot.sectionKey, body: item.body, difficulty: item.difficulty, questionVersionId: null, evidence, source: { kind: 'AI_GENERATED', name: snapshot.plan.blueprint.mode === 'AI_SOURCE' ? 'AI根据本人资料生成（待核验）' : 'AI按科目范围生成（未核验）', sourceYear: null, edition: snapshot.subjectName, url: null, checkedAt: null, rightsStatement: '仅本人私有自测；模型生成的答案与适用范围待核验，不是官方真题或人工审核题。' } }); prior.push(item.body.stem);
  }
  return { accepted, rejected: slots.length - accepted.length, failureCode: accepted.length === slots.length ? null : snapshot.plan.blueprint.mode === 'AI_SOURCE' && !accepted.length ? 'INSUFFICIENT_EVIDENCE' : 'QUALITY_REJECTED' };
}
