import { describe, expect, it } from 'vitest';
import { AiError } from '@/lib/ai/spark';
import { describeAiFailure } from '@/lib/ai/failure-message';

const KNOWN_CODES = [
  'MISSING_API_KEY', 'QUOTA_NOT_CONFIRMED', 'MODEL_CONFIG_INVALID', 'TIMEOUT',
  'SCHEMA_INVALID', 'OUTPUT_TRUNCATED', 'EMPTY_RESPONSE', 'UPSTREAM_ERROR',
  'STEP_LIMIT', 'GROUNDING_FAILED', 'REVIEW_NOT_READY', 'INSUFFICIENT_EVIDENCE', 'SOURCE_CHANGED',
];

const GENERIC = 'AI 服务暂时不可用，请稍后重试';

describe('AI 失败文案', () => {
  it.each(KNOWN_CODES)('为 %s 给出区别于兜底文案的说明', (code): void => {
    const text = describeAiFailure(new AiError('内部原始消息', code, 502));
    expect(text).not.toBe(GENERIC);
    expect(text.length).toBeGreaterThan(10);
  });

  it.each(KNOWN_CODES)('%s 的文案说明用户下一步该做什么', (code): void => {
    const text = describeAiFailure(new AiError('内部原始消息', code, 502));
    expect(text).toMatch(/重试|更换|缩小|缩短|换用|检查|补充|刷新|回看|确认|填写/);
  });

  it('不把 AiError 的原始消息透传给用户', (): void => {
    const text = describeAiFailure(new AiError('星火返回 10013：private-secret-token', 'UPSTREAM_ERROR', 502));
    expect(text).not.toContain('10013');
    expect(text).not.toContain('private-secret-token');
    expect(text).not.toContain('星火返回');
  });

  it('未知错误码回落到通用文案', (): void => {
    expect(describeAiFailure(new AiError('x', 'SOMETHING_NEW', 500))).toBe(GENERIC);
  });

  it('默认不追加收尾说明', (): void => {
    expect(describeAiFailure(new AiError('x', 'TIMEOUT', 504))).toBe('本次分析超过了时间限制，请缩小问题范围后重试');
  });

  it('把收尾说明追加在末尾', (): void => {
    expect(describeAiFailure(new AiError('x', 'TIMEOUT', 504), '；没有保存计划或提交答案'))
      .toBe('本次分析超过了时间限制，请缩小问题范围后重试；没有保存计划或提交答案');
  });

  it('配置类错误明确说明重试无效，避免用户空等', (): void => {
    expect(describeAiFailure(new AiError('x', 'MISSING_API_KEY', 500))).toContain('重试无效');
  });

  it('保留原有的审查类文案，不改变既有语义', (): void => {
    expect(describeAiFailure(new AiError('x', 'REVIEW_NOT_READY', 502))).toBe('当前模型的原文解释核验尚未通过，请到学习页回看原文');
    expect(describeAiFailure(new AiError('x', 'GROUNDING_FAILED', 502))).toBe('这次解释未通过原文核对，请回看资料或缩小问题后重试');
  });
});
