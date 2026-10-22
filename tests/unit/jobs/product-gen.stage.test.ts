import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  pointFindMany: vi.fn(),
  upsertGeneratedNote: vi.fn(),
  deleteCards: vi.fn(),
  createCard: vi.fn(),
  extractJson: vi.fn(),
  textFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.contentFindUnique },
    knowledgePoint: { findMany: mocks.pointFindMany },
    textBlock: { findMany: mocks.textFindMany },
    generatedNote: { upsert: mocks.upsertGeneratedNote },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ flashcard: { deleteMany: mocks.deleteCards, create: mocks.createCard } }),
  },
}));

vi.mock('@/lib/ai/spark', () => {
  class AiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { extractJson: mocks.extractJson, AiError };
});

vi.mock('@/lib/jobs/pipeline/document-extraction', () => ({ extractDocumentCards: mocks.extractJson }));

import { flashcardGenerationSchema, productGenStage } from '@/lib/jobs/pipeline/product-gen.stage';

/**
 * PRODUCT_GEN · 闪卡生成 单测（tasks.md §6.4）
 */

const ctx = { contentId: 'c1', traceId: 't1', degraded: { infer: false, asr: false } };

describe('productGenStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1' });
    mocks.pointFindMany.mockResolvedValue([
      { id: 'p1', title: '知识点A', summary: '摘要A', tags: [], refs: [] },
      { id: 'p2', title: '知识点B', summary: '摘要B', tags: [], refs: [] },
    ]);
    mocks.deleteCards.mockResolvedValue({ count: 0 });
    mocks.createCard.mockResolvedValue({});
  });

  it('validates flashcard bounds and required answer fields', () => {
    expect(flashcardGenerationSchema.safeParse({
      cards: [{ pointIndex: 0, front: '主要考查什么？', back: '分析推理能力。' }],
    }).success).toBe(true);
    expect(flashcardGenerationSchema.safeParse({
      cards: [{ pointIndex: -1, front: '主要考查什么？', back: '分析推理能力。' }],
    }).success).toBe(false);
    expect(flashcardGenerationSchema.safeParse({
      cards: [{ pointIndex: 0, front: '', back: '答案' }],
    }).success).toBe(false);
    expect(flashcardGenerationSchema.safeParse({ cards: [] }).success).toBe(false);
    expect(flashcardGenerationSchema.safeParse([
      { pointIndex: 0, front: '主要考查什么？', back: '分析推理能力。' },
    ])).toMatchObject({ success: true, data: { cards: [{ pointIndex: 0, front: '主要考查什么？', back: '分析推理能力。' }] } });
    expect(flashcardGenerationSchema.safeParse([
      { pointIndex: 0, front: '主要考查什么？' },
    ]).success).toBe(false);
    expect(flashcardGenerationSchema.safeParse({
      cards: [{ pointIndex: 0, front: '判断推理主要考查分析推理能力', back: '分析推理能力。' }],
    }).success).toBe(false);
    expect(flashcardGenerationSchema.safeParse({
      cards: [{ pointIndex: 0, front: '同一句话？', back: '同一句话？' }],
    }).success).toBe(false);
  });

  it('stores a valid bare array returned by the model', async () => {
    mocks.extractJson.mockImplementationOnce(async (_messages: unknown, schema: typeof flashcardGenerationSchema) => ({
      data: schema.parse([{ pointIndex: 0, front: '主要考查什么？', back: '分析推理能力。' }]),
    }));

    await productGenStage(ctx);

    expect(mocks.createCard).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pointId: 'p1', front: '主要考查什么？', back: '分析推理能力。' }),
    }));
  });

  it('generates flashcards, links to points and blocks unsafe cards', async () => {
    mocks.extractJson.mockResolvedValue({
      data: {
        cards: [
          { pointIndex: 0, front: '知识点A是什么？', back: '答案1' },
          { pointIndex: 1, front: '赌博是什么？', back: '违规' },
        ],
      },
    });

    await productGenStage(ctx);

    expect(mocks.deleteCards).toHaveBeenCalledWith({ where: { contentId: 'c1' } });
    expect(mocks.createCard).toHaveBeenCalledTimes(1);
    expect(mocks.createCard).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentId: 'c1',
          ownerId: 'u1',
          pointId: 'p1',
          status: 'NEW',
          front: '知识点A是什么？',
        }),
      }),
    );
  });

  it('rejects absent knowledge points without replacing products', async () => {
    mocks.pointFindMany.mockResolvedValueOnce([]);
    await expect(productGenStage(ctx)).rejects.toThrow('没有可用知识点');
    expect(mocks.extractJson).not.toHaveBeenCalled();
    expect(mocks.deleteCards).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedNote).not.toHaveBeenCalled();
  });

  it('propagates generation failure without replacing cards or notes', async () => {
    mocks.extractJson.mockRejectedValueOnce(new Error('TIMEOUT'));
    await expect(productGenStage(ctx)).rejects.toThrow('TIMEOUT');
    expect(mocks.createCard).not.toHaveBeenCalled();
    expect(mocks.deleteCards).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedNote).not.toHaveBeenCalled();
  });

  it.each([{ cards: [] }, { cards: [{ pointIndex: 0, front: '赌博是什么？', back: '违规' }] }])('rejects unusable cards before replacing old products: %j', async ({ cards }): Promise<void> => {
    mocks.extractJson.mockResolvedValueOnce({ data: { cards } });
    await expect(productGenStage(ctx)).rejects.toThrow('闪卡未通过内容校验');
    expect(mocks.deleteCards).not.toHaveBeenCalled();
    expect(mocks.createCard).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedNote).not.toHaveBeenCalled();
  });

  it('maps later batch indices to the correct knowledge point before replacing once', async () => {
    const points = Array.from({ length: 10 }, (_, index): { id: string; title: string; summary: string; tags: string[]; refs: never[] } => ({ id: `p${index}`, title: `标题${index}`, summary: '摘要', tags: [], refs: [] }));
    mocks.pointFindMany.mockResolvedValue(points);
    mocks.extractJson.mockResolvedValue({ data: { cards: [{ pointIndex: 1, front: '核心内容是什么？', back: '答案' }] } });
    await productGenStage(ctx);
    expect(mocks.extractJson).toHaveBeenCalledTimes(2);
    expect(mocks.createCard.mock.calls.map((call): unknown => call[0].data.pointId)).toEqual(['p1', 'p9']);
    expect(mocks.deleteCards).toHaveBeenCalledTimes(1);
    const schema = mocks.extractJson.mock.calls[1][1];
    expect(schema.safeParse({ cards: [{ pointIndex: 2, front: '是什么？', back: '答案' }] }).success).toBe(false);
  });

  it('retains existing flashcards when a later batch is unavailable', async () => {
    mocks.pointFindMany.mockResolvedValue(Array.from({ length: 10 }, (_, index): unknown => ({ id: `p${index}`, title: '标题', summary: '摘要', tags: [], refs: [] })));
    mocks.extractJson.mockResolvedValueOnce({ data: { cards: [{ pointIndex: 0, front: '是什么？', back: '答案' }] } }).mockRejectedValueOnce(new Error('later failure'));
    await expect(productGenStage(ctx)).rejects.toThrow('later failure');
    expect(mocks.deleteCards).not.toHaveBeenCalled();
  });

  it('maps validated ordered question-answer rows to their input points', async (): Promise<void> => {
    mocks.extractJson.mockImplementationOnce(async (_messages: unknown, schema: typeof flashcardGenerationSchema): Promise<{ data: unknown }> => ({
      data: schema.parse([['A是什么？', 'A的答案'], ['B是什么？', 'B的答案']]),
    }));
    await productGenStage(ctx);
    expect(mocks.createCard.mock.calls.map((call): unknown => call[0].data.pointId)).toEqual(['p1', 'p2']);
    const schema = mocks.extractJson.mock.calls[0][1];
    expect(schema.safeParse([['A是什么？', 'A的答案']]).success).toBe(false);
    expect(schema.safeParse([['A是什么？', 'A的答案'], ['B是什么？', 'B的答案'], ['C是什么？', 'C的答案']]).success).toBe(false);
  });

  it('rejects malformed rows and keeps question-answer rules', async (): Promise<void> => {
    mocks.extractJson.mockResolvedValue({ data: { cards: [{ pointIndex: 0, front: '是什么？', back: '答案' }] } });
    await productGenStage(ctx);
    const schema = mocks.extractJson.mock.calls[0][1];
    for (const row of [['问题？'], ['问题？', '答案', '额外字段'], [7, '答案'], ['陈述句', '答案'], ['问题？', ''], ['同一句？', '同一句？']]) {
      expect(schema.safeParse([row, ['另一个问题？', '另一个答案']]).success).toBe(false);
    }
  });

  it('does not replace old cards when a later ordered batch has missing rows', async (): Promise<void> => {
    mocks.pointFindMany.mockResolvedValue(Array.from({ length: 10 }, (_, index): unknown => ({ id: `p${index}`, title: '标题', summary: '摘要', tags: [], refs: [] })));
    mocks.extractJson.mockImplementation(async (_messages: unknown, schema: typeof flashcardGenerationSchema): Promise<{ data: unknown }> => ({
      data: schema.parse(Array.from({ length: 8 }, (): [string, string] => ['核心是什么？', '答案'])),
    }));
    await expect(productGenStage(ctx)).rejects.toThrow();
    expect(mocks.deleteCards).not.toHaveBeenCalled();
    expect(mocks.createCard).not.toHaveBeenCalled();
  });
  it('keeps the outer array for one point and rejects flattened pairs with row guidance', async (): Promise<void> => {
    mocks.pointFindMany.mockResolvedValue([{ id: 'p1', title: '标题', summary: '摘要', tags: [], refs: [] }]);
    mocks.extractJson.mockImplementationOnce(async (_messages: unknown, schema: typeof flashcardGenerationSchema): Promise<{ data: unknown }> => ({
      data: schema.parse([['核心是什么？', '简短答案']]),
    }));
    await productGenStage(ctx);
    const schema = mocks.extractJson.mock.calls[0][1];
    const flat = schema.safeParse(['核心是什么？', '简短答案']);
    expect(flat.success).toBe(false);
    if (!flat.success) expect(flat.error.issues[0].message).toContain('每行恰好两个字符串');
    expect(mocks.createCard).toHaveBeenCalledTimes(1);
    expect(mocks.extractJson.mock.calls[0][0][1].content).toContain('[["第1个核心是什么？","对应的简短答案"]]');
  });

  it('builds grounded document recall cards without model rewriting and sorts notes by page', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PDF' });
    mocks.pointFindMany.mockResolvedValue([
      { id: 'tail', title: '结尾', summary: '结尾包含可以回看并且核对的真实事实。', tags: [], refs: [{ type: 'document', page: 222 }] },
      { id: 'head', title: '开头', summary: '开头包含可以回看并且核对的真实事实。', tags: [], refs: [{ type: 'document', page: 1 }] },
    ]);
    mocks.textFindMany.mockResolvedValue([
      { ref: { type: 'document', page: 222 }, text: '结尾包含可以回看并且核对的真实事实。' },
      { ref: { type: 'document', page: 1 }, text: '开头包含可以回看并且核对的真实事实。' },
    ]);
    await productGenStage(ctx);
      expect(mocks.extractJson).not.toHaveBeenCalled();
      expect(mocks.createCard).toHaveBeenCalledTimes(2);
      expect(mocks.createCard.mock.calls[0][0].data.back).toBe('结尾包含可以回看并且核对的真实事实。');
      const markdown = mocks.upsertGeneratedNote.mock.calls[0][0].update.markdown as string;
      expect(markdown.indexOf('开头')).toBeLessThan(markdown.indexOf('结尾'));
  });

  it('rejects ungrounded document answers before replacing cards or notes', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PDF' });
    mocks.pointFindMany.mockResolvedValue([{ id: 'p1', title: '副省级', summary: '副省级：（40÷135）×100%=29.6%', tags: [], refs: [{ type: 'document', page: 1 }] }]);
    mocks.textFindMany.mockResolvedValue([{ ref: { type: 'document', page: 3 }, text: '副省级：（40÷135）×100%=29.6%' }]);
    await expect(productGenStage(ctx)).rejects.toThrow();
    expect(mocks.deleteCards).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedNote).not.toHaveBeenCalled();
  });

});
