import { checkContent } from '@/lib/ai/content-guard';
import { AiError } from '@/lib/ai/spark';
import { ApiError } from '@/lib/auth/ownership';
import { ErrorCode } from '@/lib/api/errors';
import { sourceQuoteChoices } from './faithfulness';
import type { AgentResult } from './contracts';
import type { ToolState } from './tools';

type EvidenceAnswer = Pick<AgentResult, 'answer' | 'citations' | 'practice' | 'plan'>;

/** A useful read-only result without publishing any model-authored explanation or plan. */
export function buildEvidenceAnswer(state: ToolState, learningSummary: string, minutes: number, planRequested: boolean): EvidenceAnswer {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new AiError('复习预算不合法', 'SCHEMA_INVALID', 502);
  const citations = state.evidence.slice(0, 5);
  const choices = sourceQuoteChoices(citations.map((source, index) => ({ sourceId: index + 1, excerpt: source.excerpt })));
  const excerpts = citations.flatMap((_source, index) => {
    const choice = choices.find((item) => item.sourceId === index + 1);
    return choice ? [`原文摘录 ${index + 1}：\n${choice.excerpt}`] : [];
  });
  const practice = state.practice.slice(0, 5);
  const answer = [
    '证据模式：原文解释暂未通过核验，先提供可回看的原文和学习安排。以下摘录保留转写原样，口误或含混处请回到资料核对。',
    `真实学习记录：${learningSummary}。`,
    ...excerpts,
    ...(!citations.length ? ['本次没有找到可核对的原文，不能据此解释内容。请回到原资料或换用更明确的关键词。'] : []),
    practice.length ? '已从本人这份资料的题库挑选练习，可自行作答后再查看判分。' : '本次没有找到可推荐的已有练习；未生成题目或提交答案。',
    planRequested ? '下方安排只是建议，尚未保存计划或计入完成记录。' : '本次未保存计划或提交答案。',
  ].join('\n\n');
  const steps: NonNullable<AgentResult['plan']>['steps'] = [];
  if (planRequested) {
    const readingMinutes = practice.length ? Math.max(1, Math.floor(minutes * 0.4)) : Math.max(1, Math.floor(minutes * 0.7));
    steps.push({ title: citations.length ? '回看引用原文，核对转写中的不确定处' : '回到原资料，定位本次学习目标', minutes: readingMinutes, pointTitles: [] });
    if (practice.length) steps.push({ title: '自行完成所选已有练习，提交后核对判分与原文', minutes: Math.max(1, Math.floor(minutes * 0.4)), pointTitles: [...new Set(practice.map((question) => question.pointTitle))] });
    steps.push({ title: '整理仍不确定的问题，记录下一次需要核对的内容', minutes: minutes - steps.reduce((sum, step) => sum + step.minutes, 0), pointTitles: [] });
  }
  const plan = planRequested ? { title: '原文核对与练习安排', targetMinutes: minutes, steps } : null;
  if (!checkContent(answer).safe || steps.some((step) => !checkContent(step.title).safe || step.pointTitles.some((title) => !checkContent(title).safe))) throw new ApiError(ErrorCode.CONTENT_BLOCKED, '证据模式内容未通过安全检查');
  return { answer, citations, practice, plan };
}
