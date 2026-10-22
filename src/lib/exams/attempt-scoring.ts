import type { ExamQuestionBody } from './contracts';
import type { SavedExamAnswer } from './student-contracts';

/** Validate against the frozen question, never current question-bank data. */
export function validExamAnswer(body: ExamQuestionBody, value: SavedExamAnswer['answer']): boolean {
  if (value === null) return true;
  if (body.type === 'TRUE_FALSE') return typeof value === 'boolean';
  if (body.type === 'SUBJECTIVE') return typeof value === 'string' && value.length <= 10000;
  const keys = new Set(body.options.map((option): string => option.key));
  if (body.type === 'SINGLE_CHOICE') return typeof value === 'string' && keys.has(value);
  return Array.isArray(value) && value.length <= keys.size && new Set(value).size === value.length && value.every((key): boolean => keys.has(key));
}
export function scoreExamAnswer(body: ExamQuestionBody, value: SavedExamAnswer['answer'], maximum: number): { scoreUnits: number; correct: boolean } | null {
  if (body.type === 'SUBJECTIVE') return null;
  const correct = validExamAnswer(body, value) && (body.type === 'TRUE_FALSE' ? value === body.correctBoolean : body.type === 'SINGLE_CHOICE' ? value === body.correctOptionKeys[0] : Array.isArray(value) && value.length === body.correctOptionKeys.length && body.correctOptionKeys.every((key): boolean => value.includes(key)));
  return { scoreUnits: correct ? maximum : 0, correct };
}
export function hasExamAnswer(value: SavedExamAnswer['answer']): boolean {
  return value !== null && (typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 : true);
}
