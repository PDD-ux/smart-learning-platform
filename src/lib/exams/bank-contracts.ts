import { z } from 'zod';
import { examSourceSchema, examTrackSchema, questionBodySchema } from './contracts';

const id = z.string().trim().min(1).max(128);
const code = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).transform((value): string => value.toUpperCase());
const name = z.string().trim().min(1).max(200);
export const bankState = z.enum(['DRAFT', 'ACTIVE', 'RETIRED']);
const request = { requestId: z.string().uuid() };
export const bankItemSchema = z.object({ difficulty: z.number().int().min(1).max(5), body: questionBodySchema, source: examSourceSchema }).strict();
export type BankItem = z.infer<typeof bankItemSchema>;
const location = { subjectId: id, chapterId: id.nullable().default(null) };
export const classificationCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subject.create'), ...request, track: examTrackSchema, code, name }).strict(),
  z.object({ action: z.literal('subject.update'), ...request, id, name, state: bankState, expectedUpdatedAt: z.string().datetime() }).strict(),
  z.object({ action: z.literal('chapter.create'), ...request, subjectId: id, code, name }).strict(),
  z.object({ action: z.literal('chapter.update'), ...request, id, name, state: bankState, expectedUpdatedAt: z.string().datetime() }).strict(),
]);
export const questionCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('question.create'), ...request, ...location, item: bankItemSchema }).strict(),
  z.object({ action: z.literal('question.revise'), ...request, id, expectedVersionNo: z.number().int().positive(), item: bankItemSchema }).strict(),
  z.object({ action: z.literal('question.state'), ...request, id, expectedVersionNo: z.number().int().positive(), expectedState: bankState, state: bankState }).strict(),
  z.object({ action: z.literal('question.review'), ...request, id, expectedVersionNo: z.number().int().positive(), expectedReviewState: z.enum(['UNREVIEWED', 'APPROVED', 'REJECTED']), expectedReviewedAt: z.string().datetime().nullable(), decision: z.enum(['APPROVED', 'REJECTED']), confirmed: z.literal(true) }).strict(),
]);
export const importCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), ...location, format: z.enum(['json', 'csv']), text: z.string().min(1).max(1_048_576) }).strict(),
  z.object({ action: z.literal('confirm'), ...request, ...location, format: z.enum(['json', 'csv']), text: z.string().min(1).max(1_048_576), previewDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
]);
export type ClassificationCommand = z.input<typeof classificationCommand>;
export type QuestionCommand = z.input<typeof questionCommand>;
export type ImportCommand = z.input<typeof importCommand>;
export type BankWriteResult = { ids: string[]; versionNo?: number };
export type BankChapter = { id: string; code: string; name: string; state: z.infer<typeof bankState>; updatedAt: string };
export type BankSubject = BankChapter & { track: z.infer<typeof examTrackSchema>; chapters: BankChapter[] };
export type BankVersion = BankItem & { id: string; versionNo: number; reviewState: 'UNREVIEWED' | 'APPROVED' | 'REJECTED'; reviewedAt: string | null };
export type BankQuestion = { id: string; subjectId: string; chapterId: string | null; state: z.infer<typeof bankState>; versions: BankVersion[] };
export type BankPage<T> = { page: number; pageSize: number; total: number; items: T[] };
export type ImportPreview = { digest: string; total: number; valid: number; errors: { row: number; field: string; message: string }[]; items: BankItem[] };

/** RFC4180-style bounded CSV: no eval, formulas or implicit coercion. */
export function parseBankCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index += 1; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (char !== ',') { rows.push(row); row = []; if (char === '\r' && text[index + 1] === '\n') index += 1; }
    } else if (char === '"' && !cell && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error('CSV引号格式不正确'); cell += char; }
    if (rows.length > 101 || row.length > 3) throw new Error('CSV最多100题，且必须为三列');
  }
  if (quoted) throw new Error('CSV引号未闭合');
  if (cell || row.length || closed) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseBankImport(format: 'json' | 'csv', raw: string): Omit<ImportPreview, 'digest'> {
  const errors: ImportPreview['errors'] = [], items: BankItem[] = [];
  if (new TextEncoder().encode(raw).length > 1_048_576) return { total: 0, valid: 0, items, errors: [{ row: 0, field: 'file', message: '文件超过1MB' }] };
  let values: unknown[];
  try {
    const text = raw.replace(/^\uFEFF/u, '');
    if (format === 'json') { const value: unknown = JSON.parse(text); if (!Array.isArray(value)) throw new Error(); values = value; }
    else {
      const [header, ...rows] = parseBankCsv(text);
      if (JSON.stringify(header) !== JSON.stringify(['difficulty', 'body', 'source'])) throw new Error();
      values = rows.map((row): unknown => {
        try { if (row.length !== 3 || !/^[1-5]$/u.test(row[0])) throw new Error(); return { difficulty: Number(row[0]), body: JSON.parse(row[1]) as unknown, source: JSON.parse(row[2]) as unknown }; }
        catch { return null; }
      });
    }
  } catch { return { total: 0, valid: 0, items, errors: [{ row: 0, field: 'file', message: 'JSON数组或CSV格式无效，请使用模板（CSV固定三列）' }] }; }
  if (!values.length || values.length > 100) return { total: values.length, valid: 0, items, errors: [{ row: 0, field: 'file', message: '每批须为1至100题' }] };
  const seen = new Set<string>();
  values.forEach((value, index): void => {
    const result = bankItemSchema.safeParse(value);
    if (!result.success) { for (const issue of result.error.issues) errors.push({ row: index + 1, field: issue.path.join('.') || 'row', message: '字段格式、答案或来源不符合模板要求' }); return; }
    const key = result.data.body.stem.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
    if (seen.has(key)) { errors.push({ row: index + 1, field: 'body.stem', message: '本批题干重复' }); return; }
    seen.add(key); items.push(result.data);
  });
  return { total: values.length, valid: items.length, items, errors };
}

export const bankExample: BankItem = { difficulty: 1, body: { type: 'SINGLE_CHOICE', stem: '自编示例：整数2与3的和是多少？', options: [{ key: 'A', text: '5' }, { key: 'B', text: '6' }], correctOptionKeys: ['A'], explanation: '2+3=5。' }, source: { kind: 'AUTHORED', name: '自编模板示例（请替换）', sourceYear: null, edition: '基础算术示例', url: null, rightsStatement: '本人自编，仅示范模板格式。', checkedAt: null } };
export function bankTemplate(format: 'json' | 'csv'): string {
  return format === 'json' ? JSON.stringify([bankExample], null, 2) : 'difficulty,body,source\r\n' + [String(bankExample.difficulty), JSON.stringify(bankExample.body), JSON.stringify(bankExample.source)].map((value): string => '"' + value.replace(/"/gu, '""') + '"').join(',');
}
