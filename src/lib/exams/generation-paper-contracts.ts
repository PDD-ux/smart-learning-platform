import { z } from 'zod';
import type { AttemptQuestion } from './contracts';
import type { ExamSourceReview, ExamSummary } from './student-contracts';
import type { GenerationPlan, GenerationStatus } from './generation-contracts';

export const confirmGenerationPaperSchema = z.object({ expectedRevision: z.number().int().min(0).max(2147483646), previewDigest: z.string().regex(/^[a-f0-9]{64}$/), targetCount: z.number().int().min(1).max(50), acceptReducedTarget: z.boolean(), requestId: z.string().uuid(), confirmed: z.literal(true) }).strict();
export type ConfirmGenerationPaper = z.infer<typeof confirmGenerationPaperSchema>;
export type GeneratedPaper = { paperId: string; versionId: string; questionCount: number; totalScoreUnits: number; durationSec: number; referenceOnly: true };
export type GenerationOptions = { page: number; pageSize: number; total: number; items: { id: string; name: string; track: ExamSummary['track'] }[] };
export type GenerationPreview = { status: GenerationStatus; plan: GenerationPlan; subjectName: string; terminal: boolean; canConfirm: boolean; unavailableReason: string | null; previewDigest: string; totalScoreUnits: number; questions: (AttemptQuestion & { sectionKey: string; sectionTitle: string; source: ExamSourceReview })[]; confirmedPaper: GeneratedPaper | null };
