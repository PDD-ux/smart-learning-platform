import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { schemaDiagnostic } from '@/lib/ai/schema-diagnostics';
import { AiError, extractJson } from '@/lib/ai/spark';

afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('safe schema diagnostics', () => {
  it('projects only fixed paths/rules and never messages, values or unknown keys', (): void => {
    const secret = 'private-model-secret-never-log';
    const issue: z.ZodIssue = { code: 'custom', path: [secret, 'options', 1], message: secret, params: { rule: secret } };
    const diagnostic = schemaDiagnostic([issue], 2);
    expect(diagnostic).toMatchObject({ fields: ['$.options.[]'], rules: [], issueCodes: ['custom'] });
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
  });
  it('keeps the homework grading field path while redacting returned values', (): void => {
    const issue: z.ZodIssue = { code: 'custom', path: ['items', 0, 'evidenceQuote'], message: 'private quote text' };
    expect(schemaDiagnostic([issue], 2)).toMatchObject({ fields: ['items.[].evidenceQuote'], issueCodes: ['custom'] });
  });
  it('retains a known failure rule nested inside union branches', (): void => {
    const shape = z.union([z.object({ options: z.array(z.string().refine(() => false, { message: 'private', params: { rule: 'OPTION_CONTENT' } })) }), z.object({ questions: z.array(z.string()) })]);
    const result = shape.safeParse({ options: ['A'] });
    expect(result.success).toBe(false);
    if (!result.success) expect(schemaDiagnostic(result.error.issues, 2).rules).toContain('OPTION_CONTENT');
  });
  it('reports invalid JSON after bounded retries without the raw response in the error', async (): Promise<void> => {
    const secret = 'private-model-secret-never-log';
    vi.stubEnv('LLM_PROVIDER', 'spark'); vi.stubEnv('SPARK_API_PASSWORD', 'unit-test-only');
    const response = (): Response => new Response(JSON.stringify({ choices: [{ message: { content: secret } }] }));
    const fetchMock = vi.fn().mockImplementation(response); vi.stubGlobal('fetch', fetchMock);
    let failure: unknown;
    try { await extractJson([{ role: 'user', content: 'JSON' }], z.object({ question: z.string() })); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AiError);
    expect(failure).toMatchObject({ code: 'SCHEMA_INVALID', diagnostic: { kind: 'invalid_json', attempts: 2, rules: [] } });
    expect(String(failure)).not.toContain(secret); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
