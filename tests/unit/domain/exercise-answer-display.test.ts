import { describe, expect, it } from 'vitest';
import { formatExerciseAnswer } from '@/components/review/formatExerciseAnswer';

describe('exercise answer display', (): void => {
  it('maps boolean text and keeps unknown answers rather than guessing', (): void => {
    const question = { type: 'true_false' as const, options: [] };
    expect(formatExerciseAnswer(question, 'true')).toBe('正确'); expect(formatExerciseAnswer(question, ' FALSE ')).toBe('错误');
    expect(formatExerciseAnswer(question, '0')).toBe('0'); expect(formatExerciseAnswer(question, '')).toBe('');
  });
  it('adds the selected option text without changing the original options', (): void => {
    const question = { type: 'single_choice' as const, options: ['原选项甲', '原选项乙'] };
    expect(formatExerciseAnswer(question, ' b ')).toBe('B. 原选项乙'); expect(question.options).toEqual(['原选项甲', '原选项乙']);
  });
  it('preserves malformed, out-of-range and empty-option legacy values', (): void => {
    const question = { type: 'single_choice' as const, options: ['甲', ''] };
    for (const answer of ['B', 'Z', 'AB', '1', '未知']) expect(formatExerciseAnswer(question, answer)).toBe(answer);
  });
  it('preserves short answers including spaces, punctuation and boolean-looking text', (): void => {
    const question = { type: 'short_answer' as const, options: [] };
    for (const answer of ['false', '  我的解释。\n下一行', '<b>原文</b>']) expect(formatExerciseAnswer(question, answer)).toBe(answer);
  });
});
