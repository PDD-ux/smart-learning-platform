import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('@/lib/ai/spark', async (original) => ({ ...await original<typeof import('@/lib/ai/spark')>(), chat: mocks.chat }));
import { extractDocumentCandidates, parseDocumentCandidates, parseDocumentCards, extractDocumentCards } from '@/lib/jobs/pipeline/document-extraction';

describe('document line protocol', (): void => {
  beforeEach((): void => { vi.clearAllMocks(); });
  it('preserves quoted logic sentences without guessing source references', (): void => {
    expect(parseDocumentCandidates('来源: S2,S3\n标题: 矛盾关系\n摘要: “所有A都是B”与“有的A不是B”互为矛盾。')).toEqual({
      points: [{ sourceIds: ['S2', 'S3'], title: '矛盾关系', summary: '“所有A都是B”与“有的A不是B”互为矛盾。' }],
    });
  });
  it.each(['', '来源:S1\n标题:缺摘要', '标题:乱序\n来源:S1\n摘要:正文。', '来源:S99 abc\n标题:标题\n摘要:正文。', '```\n来源:S1\n标题:标题\n摘要:正文。\n```'])('rejects incomplete or extra lines: %s', (text): void => {
    expect(() => parseDocumentCandidates(text)).toThrow();
  });
  it('retries once, never echoes malformed output, and retains schema validation', async (): Promise<void> => {
    mocks.chat.mockResolvedValueOnce({ content: '来源:S1\n标题:缺摘要' }).mockResolvedValueOnce({ content: '来源:S1\n标题:标题\n摘要:完整。' });
    const schema = z.object({ points: z.array(z.object({ sourceIds: z.array(z.literal('S1')), title: z.string(), summary: z.string() })) });
    const result = await extractDocumentCandidates([{ role: 'user', content: '真实S1' }], schema, { provider: 'spark' });
    expect(result.attempts).toBe(2);
    expect(mocks.chat.mock.calls[0][1]).toMatchObject({ provider: 'spark', jsonMode: false });
    expect(mocks.chat.mock.calls[1][0]).not.toContainEqual({ role: 'assistant', content: '来源:S1\n标题:缺摘要' });
  });
  it('fails after two attempts when every reference is invalid', async (): Promise<void> => {
    mocks.chat.mockResolvedValue({ content: '来源:S99\n标题:标题\n摘要:完整。' });
    const schema = z.object({ points: z.array(z.object({ sourceIds: z.array(z.literal('S1')) })) });
    await expect(extractDocumentCandidates([{ role: 'user', content: '真实S1' }], schema, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(mocks.chat).toHaveBeenCalledTimes(2);
  });
  it('keeps quotes in answers and never fabricates a missing question or index', (): void => {
    expect(parseDocumentCards('知识点:0\n问题:什么互为矛盾？\n答案:“所有A都是B”与“有的A不是B”。')).toEqual({
      cards: [{ pointIndex: 0, front: '什么互为矛盾？', back: '“所有A都是B”与“有的A不是B”。' }],
    });
    expect(() => parseDocumentCards('知识点:0\n答案:缺问题')).toThrow();
  });
  it('uses flashcard-specific correction and rejects unknown indices twice', async (): Promise<void> => {
    mocks.chat.mockResolvedValue({ content: '知识点:99\n问题:是什么？\n答案:答案。' });
    const schema = z.object({ cards: z.array(z.object({ pointIndex: z.literal(0) })) });
    await expect(extractDocumentCards([{ role: 'user', content: '本批编号0' }], schema, {})).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(mocks.chat.mock.calls[1][0][1].content).toContain('知识点、问题、答案三行格式');
  });
  it('keeps single-line selection correction separate from the historical three-line protocol', async (): Promise<void> => {
    mocks.chat.mockResolvedValueOnce({ content: '重写了一段摘要' }).mockResolvedValueOnce({ content: '事实:F1' });
    const schema = z.object({ id: z.literal('F1') });
    const parse = (text: string): { id: string } => {
      if (text !== '事实:F1') throw new Error('只选实际编号');
      return { id: 'F1' };
    };
    expect((await extractDocumentCandidates([{ role: 'user', content: 'F1原文' }], schema, {}, parse, '事实:F1', 1)).attempts).toBe(2);
    expect(mocks.chat.mock.calls[1][0][1].content).toContain('单行格式');
    expect(mocks.chat.mock.calls[1][0][1].content).not.toContain('三行');
  });
});
