import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contentFindUnique: vi.fn(),
  deletePoints: vi.fn(),
  createPoint: vi.fn(),
  upsertNode: vi.fn(),
  extractJson: vi.fn(),
  buildContext: vi.fn(),
  buildGraph: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learningContent: { findUnique: mocks.contentFindUnique },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        knowledgePoint: { deleteMany: mocks.deletePoints, create: mocks.createPoint },
        graphNode: { upsert: mocks.upsertNode },
      }),
  },
}));

vi.mock('@/lib/ai/spark', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ai/spark')>(),
  extractJson: mocks.extractJson,
}));

vi.mock('@/lib/jobs/pipeline/context-builder', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jobs/pipeline/context-builder')>(),
  buildStructuredContext: mocks.buildContext,
}));

vi.mock('@/lib/jobs/pipeline/graph-build.stage', () => ({
  buildGraphStage: mocks.buildGraph,
}));

vi.mock('@/lib/jobs/pipeline/document-extraction', () => ({ extractDocumentCandidates: mocks.extractJson }));

import { deepExtractStage, knowledgeExtractionSchema } from '@/lib/jobs/pipeline/deep-extract.stage';
import { AiError } from '@/lib/ai/spark';

/**
 * 阶段 B · 知识点抽取 单测（tasks.md §6.4）
 */

const ctx = { contentId: 'c1', traceId: 't1', degraded: { infer: false, asr: false } };

describe('deepExtractStage', () => {
  const sourcedContext = { text: '这里包含可以核对的完整课堂原文。', sourceRefs: [{ type: 'video', timestampSec: 6 }],
    sourceSegments: [{ ref: { type: 'video', timestampSec: 6 }, text: '这里包含可以核对的完整课堂原文。' }], noteTexts: [], stats: {}, truncated: false };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PNG', durationSec: 60, pageCount: 1 });
    mocks.buildContext.mockResolvedValue({
      text: 'context',
      stats: { transcriptCount: 1, textBlockCount: 0, noteCount: 0 },
      truncated: false,
      sourceRefs: [],
    });
    mocks.deletePoints.mockResolvedValue({ count: 0 });
    mocks.createPoint.mockResolvedValue({ id: 'p1' });
    mocks.upsertNode.mockResolvedValue({});
    mocks.buildGraph.mockResolvedValue(undefined);
  });

  it('validates knowledge point boundaries and ContentRef values', () => {
    expect(knowledgeExtractionSchema.safeParse({
      points: [{ title: '标题', summary: '摘要', importance: 3 }],
    }).success).toBe(true);
    expect(knowledgeExtractionSchema.parse({
      points: [{ title: '缺少重要度的标题', summary: '摘要' }],
    }).points[0]?.importance).toBe(3);
    expect(knowledgeExtractionSchema.safeParse({
      points: [{ title: '标题', summary: '摘要', importance: 6 }],
    }).success).toBe(false);
    expect(knowledgeExtractionSchema.safeParse({
      points: [{ title: '标题', summary: '摘要', importance: 3, refs: [{ type: 'video', timestampSec: -1 }] }],
    }).success).toBe(false);
    expect(knowledgeExtractionSchema.safeParse({ points: [] }).success).toBe(false);
  });

  it('stores knowledge points, upserts graph nodes and blocks unsafe output', async () => {
    mocks.extractJson.mockResolvedValue({
      data: {
        points: [
          { title: '安全知识点', summary: '正常摘要', tags: ['t'], importance: 3, refs: [] },
          { title: '赌博内容', summary: '违规摘要', tags: [], importance: 1, refs: [] },
        ],
      },
    });

    await deepExtractStage(ctx);

    expect(mocks.deletePoints).toHaveBeenCalledWith({ where: { contentId: 'c1' } });
    expect(mocks.createPoint).toHaveBeenCalledTimes(1);
    expect(mocks.createPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentId: 'c1', ownerId: 'u1', title: '安全知识点' }),
      }),
    );
    expect(mocks.upsertNode).toHaveBeenCalledWith({
      where: { pointId: 'p1' },
      update: {},
      create: { pointId: 'p1', nodeType: 'CONCEPT' },
    });
    expect(mocks.buildGraph).toHaveBeenCalledWith(ctx);
  });

  it('rejects empty context before replacing old points', async () => {
    mocks.buildContext.mockResolvedValue({
      text: '   ',
      stats: { transcriptCount: 0, textBlockCount: 0, noteCount: 0 },
      truncated: false,
    });
    await expect(deepExtractStage(ctx)).rejects.toThrow('没有可用知识点');
    expect(mocks.extractJson).not.toHaveBeenCalled();
    expect(mocks.deletePoints).not.toHaveBeenCalled();
  });

  it('propagates unavailable extraction before replacing old points', async () => {
    mocks.extractJson.mockRejectedValueOnce(new Error('MISSING_API_KEY'));
    await expect(deepExtractStage(ctx)).rejects.toThrow('MISSING_API_KEY');
    expect(mocks.deletePoints).not.toHaveBeenCalled();
  });

  it.each([{ points: [] }, { points: [{ title: '赌博内容', summary: '违规摘要', tags: [], importance: 1, refs: [] }] }])('rejects unusable output without deleting old points: %j', async ({ points }): Promise<void> => {
    mocks.extractJson.mockResolvedValueOnce({ data: { points } });
    await expect(deepExtractStage(ctx)).rejects.toThrow();
    expect(mocks.deletePoints).not.toHaveBeenCalled();
    expect(mocks.createPoint).not.toHaveBeenCalled();
    expect(mocks.buildGraph).not.toHaveBeenCalled();
  });

  it('throws when the content record is missing', async () => {
    mocks.contentFindUnique.mockResolvedValueOnce(null);
    await expect(deepExtractStage(ctx)).rejects.toThrow('content not found');
  });

  it('maps selected source IDs to exact stored timestamps without storing the IDs', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue(sourcedContext);
    mocks.extractJson.mockResolvedValue({ data: { points: [{ title: '标题', summary: '摘要', tags: [], importance: 3, sourceIds: ['S1'], refs: [{ type: 'video', timestampSec: 6 }] }] } });
    await deepExtractStage(ctx);
    const data = mocks.createPoint.mock.calls[0][0].data;
    expect(data.refs).toEqual([{ type: 'video', timestampSec: 6 }]);
    expect(data).not.toHaveProperty('sourceIds');
  });

  it('passes missing, unknown and partly missing citations to the existing schema retry gate', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue(sourcedContext);
    mocks.extractJson.mockResolvedValue({ data: { points: [{ title: '标题', summary: '摘要', tags: [], importance: 3, sourceIds: ['S1'], refs: [] }] } });
    await deepExtractStage(ctx);
    const schema = mocks.extractJson.mock.calls[0][1];
    const point = { title: '标题', summary: '摘要' };
    expect(schema.safeParse({ points: [point] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ ...point, sourceIds: ['S99'] }] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ ...point, sourceIds: ['S1'] }, point] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ sourceIds: ['S1'] }] }).success).toBe(true);
    expect(schema.safeParse({ points: [{ ...point, sourceIds: ['S1'] }] }).success).toBe(false);
    expect(schema.safeParse({ points: [{ ...point, refs: [{ type: 'video', timestampSec: 7 }] }] }).success).toBe(false);
  });

  it('propagates exhausted source validation without deleting the previous artifacts', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue(sourcedContext);
    mocks.extractJson.mockRejectedValue(new AiError('two invalid responses', 'SCHEMA_INVALID'));
    await expect(deepExtractStage(ctx)).rejects.toThrow('two invalid responses');
    expect(mocks.deletePoints).not.toHaveBeenCalled();
    expect(mocks.createPoint).not.toHaveBeenCalled();
    expect(mocks.buildGraph).not.toHaveBeenCalled();
  });

  it('rejects video text without authorised source records before replacing points', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue({ text: '只有个人笔记不能成为视频事实', sourceRefs: [], sourceSegments: [], stats: {}, truncated: false });
    await expect(deepExtractStage(ctx)).rejects.toMatchObject({ code: 'INSUFFICIENT_EVIDENCE' });
    expect(mocks.extractJson).not.toHaveBeenCalled();
    expect(mocks.deletePoints).not.toHaveBeenCalled();
  });

  it('preserves old video products when the model explicitly finds no usable evidence', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue(sourcedContext);
    mocks.extractJson.mockResolvedValue({ data: { points: [] } });
    await expect(deepExtractStage(ctx)).rejects.toMatchObject({ code: 'INSUFFICIENT_EVIDENCE' });
    // 弃权会在窗口内最多重试 3 次，仍全部弃权才按依据不足失败
    expect(mocks.extractJson).toHaveBeenCalledTimes(3);
    expect(mocks.deletePoints).not.toHaveBeenCalled();
    expect(mocks.createPoint).not.toHaveBeenCalled();
    expect(mocks.buildGraph).not.toHaveBeenCalled();
  });

  it('recovers when the model abstains on the first selection then returns evidence', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 60, pageCount: null });
    mocks.buildContext.mockResolvedValue(sourcedContext);
    let calls = 0;
    mocks.extractJson.mockImplementation(async (_messages: unknown, schema: { parse: (value: unknown) => unknown }) => {
      calls += 1;
      if (calls === 1) return { data: schema.parse({ points: [] }) };
      if (calls === 2) return { data: schema.parse({ points: [{ sourceIds: ['S1'] }] }) };
      return { data: schema.parse({ points: [{ sourceIds: ['S1'], title: '映射的定义', summary: '一一对应', tags: ['定义'], importance: 3 }] }) };
    });
    await deepExtractStage(ctx);
    // 第 1 次弃权重试，第 2 次成功；视频模式每窗仅一次调用
    expect(mocks.extractJson).toHaveBeenCalledTimes(2);
    expect(mocks.deletePoints).toHaveBeenCalledTimes(1);
    expect(mocks.createPoint).toHaveBeenCalled();
  });

  it('extracts all windows with local source IDs mapped before a single replacement', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 660, pageCount: null });
    mocks.buildContext.mockImplementation(async (_id: string, _budget: number, window: { startSec: number }): Promise<unknown> => ({
      ...sourcedContext, sourceRefs: [{ type: 'video', timestampSec: window.startSec + 6 }],
      sourceSegments: [{ ref: { type: 'video', timestampSec: window.startSec + 6 }, text: '本窗包含可以核对的完整课堂原文。' }],
    }));
    mocks.extractJson.mockResolvedValue({ data: { points: [{ title: '本窗标题', summary: '本窗摘要', tags: [], importance: 3, sourceIds: ['S1'], refs: [] }] } });
    mocks.extractJson.mockImplementation(async (_messages: unknown, schema: typeof knowledgeExtractionSchema) => ({ data: schema.parse({ points: [{ sourceIds: ['S1'] }] }) }));
    await deepExtractStage(ctx);
    expect(mocks.buildContext.mock.calls.map((call): unknown => call[2])).toEqual([
      { startSec: 0, endSec: 300 }, { startSec: 300, endSec: 600 }, { startSec: 600, endSec: 660.001 },
    ]);
    expect(mocks.createPoint.mock.calls.map((call): unknown => call[0].data.refs)).toEqual([6, 306, 606].map((timestampSec): unknown => [{ type: 'video', timestampSec }]));
    expect(mocks.deletePoints).toHaveBeenCalledTimes(1);
    expect(mocks.deletePoints.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.extractJson.mock.invocationCallOrder.at(-1)!);
  });

  it('does not replace any knowledge points when a later window fails', async () => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 660, pageCount: null });
    mocks.buildContext.mockResolvedValue(sourcedContext);
    mocks.extractJson.mockResolvedValueOnce({ data: { points: [{ title: '标题', summary: '摘要', tags: [], importance: 3, refs: [], sourceIds: ['S1'] }] } })
      .mockRejectedValueOnce(new AiError('later window timeout', 'TIMEOUT'));
    await expect(deepExtractStage(ctx)).rejects.toThrow('later window timeout');
    expect(mocks.deletePoints).not.toHaveBeenCalled();
    expect(mocks.createPoint).not.toHaveBeenCalled();
  });

  it.each(['', '……（中间内容因长度限制已省略）'])('rejects a populated later window whose retained context has no evidence: %s', async (text: string): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 660, pageCount: null });
    mocks.buildContext.mockResolvedValueOnce(sourcedContext).mockResolvedValueOnce({
      text, stats: { transcriptCount: 1, textBlockCount: 0, noteCount: 0 }, truncated: true,
      sourceRefs: [], sourceSegments: [], noteTexts: [],
    });
    mocks.extractJson.mockResolvedValue({ data: { points: [{ title: '标题', summary: '摘要', tags: [], importance: 3, refs: [], sourceIds: ['S1'] }] } });
    await expect(deepExtractStage(ctx)).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(mocks.extractJson).toHaveBeenCalledTimes(1);
    expect(mocks.deletePoints).not.toHaveBeenCalled();
    expect(mocks.createPoint).not.toHaveBeenCalled();
    expect(mocks.buildGraph).not.toHaveBeenCalled();
  });

  it('skips a genuinely empty window and still extracts later sourced windows', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 660, pageCount: null });
    mocks.buildContext.mockResolvedValueOnce({ text: '', stats: { transcriptCount: 0, textBlockCount: 0, noteCount: 0 },
      truncated: false, sourceRefs: [], sourceSegments: [], noteTexts: [] }).mockResolvedValue(sourcedContext);
    mocks.extractJson.mockResolvedValue({ data: { points: [{ title: '标题', summary: '摘要', tags: [], importance: 3, refs: [], sourceIds: ['S1'] }] } });
    await deepExtractStage(ctx);
    expect(mocks.extractJson).toHaveBeenCalledTimes(2);
    expect(mocks.createPoint).toHaveBeenCalledTimes(2);
    expect(mocks.deletePoints).toHaveBeenCalledTimes(1);
  });

  it('rejects a populated window when every retained reference is outside the video range', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'VIDEO', durationSec: 660, pageCount: null });
    mocks.buildContext.mockResolvedValue({ text: '解析内容', stats: { transcriptCount: 0, textBlockCount: 1, noteCount: 0 },
      sourceRefs: [{ type: 'video', timestampSec: 1000 }], sourceSegments: [], noteTexts: [], truncated: false });
    await expect(deepExtractStage(ctx)).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(mocks.extractJson).not.toHaveBeenCalled();
    expect(mocks.deletePoints).not.toHaveBeenCalled();
  });

  it('processes document head/middle/tail before replacement with document provider', async (): Promise<void> => {
    vi.stubEnv('LLM_PROVIDER', 'spark');
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PDF', durationSec: null, pageCount: 30 });
    const sourceSegments = Array.from({ length: 30 }, (_, index) => ({ ref: { type: 'document', page: index + 1 }, text: `正文${index}包含可以回看与核对的完整事实。` }));
    mocks.buildContext.mockResolvedValue({ text: '全部正文', stats: { transcriptCount: 0, textBlockCount: 30, noteCount: 0 },
      truncated: false, sourceSegments, sourceRefs: sourceSegments.map((source) => source.ref), noteTexts: [] });
    mocks.extractJson.mockImplementation(async (_messages: unknown, schema: typeof knowledgeExtractionSchema): Promise<{ data: unknown }> => {
      const index = (mocks.extractJson.mock.calls.length - 1) * 12;
      return { data: schema.parse({ points: [{ title: `正文${index}`, summary: `正文${index}包含可以回看与核对的完整事实。`, sourceIds: ['S1'] }] }) };
    });
    try {
      await deepExtractStage(ctx);
      expect(mocks.buildContext).toHaveBeenCalledWith('c1', Number.MAX_SAFE_INTEGER);
      expect(mocks.createPoint.mock.calls.map((call): unknown => call[0].data.refs)).toEqual([1, 13, 25].map((page) => [{ type: 'document', page }]));
      expect(mocks.extractJson.mock.calls[0][2].provider).toBe('spark');
      expect(mocks.deletePoints.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.extractJson.mock.invocationCallOrder.at(-1)!);
      const schema = mocks.extractJson.mock.calls[2][1];
      expect(schema.safeParse({ points: [{ title: '外批', summary: '摘要', refs: [{ type: 'document', page: 1 }] }] }).success).toBe(false);
      expect(schema.safeParse({ points: [{ title: '本批', summary: '摘要', refs: [{ type: 'document', page: 25 }] }] }).success).toBe(false);
      const invalid = schema.safeParse({ points: [{ title: '未引用', summary: '摘要', sourceIds: [] }] });
      expect(invalid.success).toBe(false);
      if (!invalid.success) expect(invalid.error.issues[0].message).toContain('无有效原文事实');
      const partlyInvalid = schema.safeParse({ points: [
        { title: '完整事实', summary: '正文24包含可以回看与核对的完整事实。', sourceIds: ['S1'] },
        { title: '缺引用', summary: '完整句子。' },
        { title: '截断', summary: '尚未完成的', sourceIds: ['S1'] },
      ] });
      expect(partlyInvalid).toMatchObject({ success: true, data: { rejectedPoints: 2, points: [{ title: '完整事实' }] } });
      expect(schema.safeParse({ points: [{ title: '未知引用', summary: '完整。', sourceIds: ['S99'] }] }).success).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it('preserves old document points when a later document batch fails', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PDF', durationSec: null, pageCount: 20 });
    const sourceSegments = Array.from({ length: 20 }, (_, index) => ({ ref: { type: 'document', page: index + 1 }, text: '正文包含可以回看与核对的完整事实。' }));
    mocks.buildContext.mockResolvedValue({ text: '全部正文', stats: { transcriptCount: 0, textBlockCount: 20, noteCount: 0 },
      truncated: false, sourceSegments, sourceRefs: sourceSegments.map((source) => source.ref), noteTexts: [] });
    mocks.extractJson.mockResolvedValueOnce({ data: { points: [{ title: '标题', summary: '摘要', tags: [], importance: 3, refs: [], sourceIds: ['S1'] }] } })
      .mockRejectedValueOnce(new AiError('later document timeout', 'TIMEOUT'));
    await expect(deepExtractStage(ctx)).rejects.toThrow('later document timeout');
    expect(mocks.deletePoints).not.toHaveBeenCalled();
    expect(mocks.createPoint).not.toHaveBeenCalled();
  });

  it('binds quotes only to supporting selected pages and rejects invented titles', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PDF', durationSec: null, pageCount: 3 });
    const sourceSegments = [
      { ref: { type: 'document', page: 1 }, text: '本页只有其他概念的定义，不能支持题量占比。' },
      { ref: { type: 'document', page: 3 }, text: '副省级：（40 ÷135）×100%=29.6%' },
    ];
    mocks.buildContext.mockResolvedValue({ text: '正文', stats: { transcriptCount: 0, textBlockCount: 2, noteCount: 0 }, truncated: false, sourceSegments, sourceRefs: sourceSegments.map((s) => s.ref), noteTexts: [] });
    mocks.extractJson.mockImplementationOnce(async (_messages: unknown, schema: typeof knowledgeExtractionSchema): Promise<{ data: unknown }> => {
      const candidate = { title: '副省级', summary: '副省级：(40÷135)×100%=29.6%', sourceIds: ['S1', 'S2'], refs: [{ type: 'document', page: 1 }] };
      expect(schema.safeParse({ points: [{ ...candidate, title: '命题趋势' }] }).success).toBe(false);
      expect(schema.safeParse({ points: [{ ...candidate, summary: '副省级的题目难度明显提高了。' }] }).success).toBe(false);
      return { data: schema.parse({ points: [candidate, candidate] }) };
    });
    await deepExtractStage(ctx);
    expect(mocks.createPoint).toHaveBeenCalledTimes(1);
    expect(mocks.createPoint).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ summary: sourceSegments[1].text, refs: [{ type: 'document', page: 3 }] }) }));
  });

  it('keeps old points when the whole document is only navigation, even across split fragments', async (): Promise<void> => {
    mocks.contentFindUnique.mockResolvedValue({ ownerId: 'u1', contentType: 'DOCUMENT', format: 'PDF', durationSec: null, pageCount: 1 });
    const text = '目录\n' + '第一章........1\n第二章........2\n第三章........3\n'.repeat(250);
    const sourceSegments = [{ ref: { type: 'document', page: 1 }, text }];
    mocks.buildContext.mockResolvedValue({ text, stats: { transcriptCount: 0, textBlockCount: 1, noteCount: 0 }, truncated: false, sourceSegments, sourceRefs: sourceSegments.map((s) => s.ref), noteTexts: [] });
    await expect(deepExtractStage(ctx)).rejects.toThrow('正文事实');
    expect(mocks.extractJson).not.toHaveBeenCalled();
    expect(mocks.deletePoints).not.toHaveBeenCalled();
  });
});
