import { describe, expect, it } from 'vitest';
import { bankExample, bankTemplate, classificationCommand, importCommand, parseBankCsv, parseBankImport, questionCommand } from '@/lib/exams/bank-contracts';

describe('controlled exam bank import', () => {
  it.each(['json', 'csv'] as const)('round trips the %s template including BOM', (format) => {
    const result = parseBankImport(format, '\uFEFF' + bankTemplate(format));
    expect(result.errors).toEqual([]); expect(result.items).toEqual([bankExample]); expect(result.valid).toBe(1);
  });
  it('handles quoted commas, escaped quotes and physical multiline fields', () => {
    expect(parseBankCsv('a,b,c\r\n"x,y","say ""hi""","a\nb"\r\n')).toEqual([['a', 'b', 'c'], ['x,y', 'say "hi"', 'a\nb']]);
    for (const value of ['a,"open', '"closed"trailing,x', 'a"quote,x']) expect(() => parseBankCsv(value)).toThrow();
  });
  it('rejects wrong headers, shapes, oversized and empty batches', () => {
    for (const [format, text] of [['csv', 'body,source,difficulty\n{}, {},1'], ['csv', 'difficulty,body,source\n1,{}'], ['json', '{}'], ['json', '[]'], ['json', 'bad json'], ['json', JSON.stringify(Array(101).fill(bankExample))], ['json', '中'.repeat(400000)]] as const) expect(parseBankImport(format, text).errors.length).toBeGreaterThan(0);
  });
  it('reports row fields, rejects unknown keys, bad answers and repeated stems without silently accepting', () => {
    const result = parseBankImport('json', JSON.stringify([bankExample, { ...bankExample, ownerId: 'injected' }, { ...bankExample, body: { ...bankExample.body, correctOptionKeys: ['absent'] } }, { ...bankExample, body: { ...bankExample.body, stem: bankExample.body.stem + ' ' } }]));
    expect(result.valid).toBe(1); expect(new Set(result.errors.map((item) => item.row))).toEqual(new Set([2, 3, 4]));
    expect(result.errors.some((item) => item.field === 'body.correctOptionKeys')).toBe(true);
  });
  it('does not allow AI-generated provenance to claim official source years or URLs', () => {
    const item = { ...bankExample, source: { ...bankExample.source, kind: 'AI_GENERATED', sourceYear: 2026, url: 'https://example.test' } };
    expect(parseBankImport('json', JSON.stringify([item])).valid).toBe(0);
  });
  it('requires explicit confirmation, digest and UUID and rejects extra authority fields', () => {
    const base = { action: 'confirm', subjectId: 's', format: 'json', text: bankTemplate('json'), requestId: '00000000-0000-4000-8000-000000000000', previewDigest: 'a'.repeat(64), confirmed: true };
    expect(importCommand.safeParse(base).success).toBe(true);
    for (const change of [{ confirmed: false }, { requestId: '' }, { previewDigest: 'changed' }, { ownerId: 'u' }]) expect(importCommand.safeParse({ ...base, ...change }).success).toBe(false);
    expect(questionCommand.safeParse({ action: 'question.create', subjectId: 's', item: bankExample, requestId: base.requestId, reviewState: 'APPROVED' }).success).toBe(false);
  });
  it('normalizes codes, freezes classification identity on update and requires version/CAS fields', () => {
    const requestId = '00000000-0000-4000-8000-000000000000';
    expect(classificationCommand.parse({ action: 'subject.create', requestId, track: 'UNIVERSITY', code: 'math', name: '数学' })).toMatchObject({ code: 'MATH' });
    expect(classificationCommand.safeParse({ action: 'subject.update', requestId, id: 's', name: '数学', state: 'ACTIVE', track: 'UNIVERSITY', expectedUpdatedAt: new Date().toISOString() }).success).toBe(false);
    expect(questionCommand.safeParse({ action: 'question.review', requestId, id: 'q', expectedVersionNo: 1, decision: 'APPROVED', confirmed: true }).success).toBe(false);
  });
});
