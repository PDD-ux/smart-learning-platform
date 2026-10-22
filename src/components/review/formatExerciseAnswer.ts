import type { Exercise } from '@/services/api';

/** Display only: preserve the stored/submitted value and unknown legacy formats. */
export function formatExerciseAnswer(question: Pick<Exercise, 'type' | 'options'>, answer: string): string {
  if (question.type === 'short_answer') return answer;
  const normalized = answer.trim();
  if (question.type === 'true_false') {
    if (normalized.toLowerCase() === 'true') return '正确';
    if (normalized.toLowerCase() === 'false') return '错误';
    return answer;
  }
  const letter = normalized.toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return answer;
  const option = question.options[letter.charCodeAt(0) - 65];
  return option?.trim() ? `${letter}. ${option}` : answer;
}
