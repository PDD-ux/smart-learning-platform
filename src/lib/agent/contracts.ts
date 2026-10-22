import { z } from 'zod';
import type { ContentRef } from '@/lib/domain/content-ref';

export const agentRequestSchema = z.object({
  contentId: z.string().min(1).max(100),
  message: z.string().trim().min(1).max(1000),
  minutes: z.number().int().min(5).max(120).default(20),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1500) }).strict()).max(6).default([]),
}).strict();
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export const agentDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('learning_status') }).strip(),
  z.object({ action: z.literal('search_material'), query: z.string().trim().min(1).max(200), pointNumber: z.number().int().positive().optional() }).strip(),
  z.object({ action: z.literal('select_practice'), pointNumbers: z.array(z.number().int().positive()).max(5).default([]), count: z.number().int().min(1).max(5).default(3) }).strip(),
  z.object({ action: z.literal('finish') }).strip(),
]);
export const agentAnswerSchema = z.object({ answer: z.string().trim().min(1).max(3000), sourceIds: z.array(z.number().int().positive()).max(12).default([]), exerciseNumbers: z.array(z.number().int().positive()).max(5).default([]),
    plan: z.object({ title: z.string().trim().min(1).max(100), steps: z.array(z.object({ title: z.string().trim().min(1).max(150), minutes: z.number().int().min(1).max(120), pointNumbers: z.array(z.number().int().positive()).max(5).default([]) }).strip()).min(1).max(5) }).strip().nullable().default(null),
  }).strip();
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentToolName = Exclude<AgentDecision['action'], 'finish'>;
export type AgentPractice = { exerciseId: string; contentId: string; contentTitle: string; pointId: string; pointTitle: string; type: 'single_choice' | 'true_false' | 'short_answer'; question: string; options: string[]; index: number; latestRecord: null };
export type AgentResult = {
  runId: string; contentId: string; answer: string; createdAt: string;
  citations: Array<{ ref: ContentRef; excerpt: string }>;
  steps: Array<{ tool: AgentToolName; label: string; summary: string }>;
  practice: AgentPractice[];
  plan: { title: string; targetMinutes: number; steps: Array<{ title: string; minutes: number; pointTitles: string[] }> } | null;
};
