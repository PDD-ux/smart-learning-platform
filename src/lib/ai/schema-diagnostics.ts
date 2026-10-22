import { z } from 'zod';

export const QUALITY_RULES = ['OPTION_CONTENT', 'OPTION_UNIQUE', 'ANSWER_RANGE', 'ANSWER_VALUE', 'EXPLANATION_CONFLICT', 'QUESTION_STATEMENT', 'ANSWER_BOOLEAN', 'OPTIONS_UNEXPECTED', 'DUPLICATE_QUESTION', 'DUPLICATE_FACT', 'POINT_SCOPE', 'TYPE_SCOPE'] as const;
export type QualityRule = typeof QUALITY_RULES[number];
export type SchemaDiagnostic = {
  kind: 'invalid_json' | 'invalid_schema';
  attempts: number;
  fields: string[];
  issueCodes: string[];
  rules: QualityRule[];
};
const fields = new Set(['questions', 'question', 'options', 'correctOption', 'wrongOption', 'answerIndex', 'answer', 'correctAnswer', 'explanation', 'pointIndex', 'type', 'items', 'number', 'assessment', 'suggestedScore', 'errorCause', 'reason', 'evidenceQuote', 'nextStep']);

/** Project only trusted field/rule names; Zod messages and received values are private. */
export function schemaDiagnostic(issues: z.ZodIssue[], attempts: number): SchemaDiagnostic {
  const result: SchemaDiagnostic = { kind: 'invalid_schema', attempts, fields: [], issueCodes: [], rules: [] };
  const visit = (items: z.ZodIssue[], depth: number): void => {
    for (const issue of items.slice(0, 20)) {
      const safePath = issue.path.map(part => typeof part === 'number' ? '[]' : fields.has(part) ? part : '$').join('.');
      result.fields.push(safePath || '$');
      result.issueCodes.push(issue.code);
      if (issue.code === 'custom' && QUALITY_RULES.includes(issue.params?.rule as QualityRule)) result.rules.push(issue.params?.rule as QualityRule);
      if (issue.code === 'invalid_union' && depth < 4) for (const branch of issue.unionErrors.slice(0, 4)) visit(branch.issues, depth + 1);
    }
  };
  visit(issues, 0);
  return { ...result, fields: [...new Set(result.fields)].slice(0, 8), issueCodes: [...new Set(result.issueCodes)].slice(0, 8), rules: [...new Set(result.rules)].slice(0, 8) };
}
