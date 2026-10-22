import { z } from 'zod';
import type { LearningPlan } from '@prisma/client';

export const createPlanSchema = z.object({
  contentId: z.string().min(1),
  title: z.string().trim().min(1).max(100),
  targetMinutes: z.number().int().min(1).max(600),
  scheduledAt: z.string().datetime({ offset: true }),
  remindAt: z.string().datetime({ offset: true }),
}).refine((value) => Date.parse(value.remindAt) <= Date.parse(value.scheduledAt), {
  message: '提醒时间不能晚于学习时间', path: ['remindAt'],
});

export function planDto(plan: LearningPlan & { content: { title: string } }, now = new Date()): {
  planId: string; contentId: string; contentTitle: string; title: string; targetMinutes: number;
  scheduledAt: string; remindAt: string; completedAt: string | null; isDue: boolean;
} {
  return {
    planId: plan.id, contentId: plan.contentId, contentTitle: plan.content.title,
    title: plan.title, targetMinutes: plan.targetMinutes,
    scheduledAt: plan.scheduledAt.toISOString(), remindAt: plan.remindAt.toISOString(),
    completedAt: plan.completedAt?.toISOString() ?? null,
    isDue: plan.completedAt === null && plan.remindAt <= now,
  };
}
