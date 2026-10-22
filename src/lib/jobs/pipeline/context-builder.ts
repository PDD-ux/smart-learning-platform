import { prisma } from '@/lib/prisma';
import { contentRefSchema, type ContentRef } from '@/lib/domain/content-ref';

/**
 * 结构上下文拼装器（tasks.md §6.4）
 * ------------------------------------------------------------
 * 聚合转写段落 + 关键帧文本 + 图文文本块 + 学习者笔记，按 token 预算分块截断
 * （保序、保首尾章节），供阶段 B 大模型深度理解使用。
 */

export type StructuredContextStats = {
  transcriptCount: number;
  textBlockCount: number;
  noteCount: number;
};

export type StructuredContext = {
  text: string;
  stats: StructuredContextStats;
  truncated: boolean;
  sourceRefs: ContentRef[];
  sourceSegments: { ref: ContentRef; text: string }[];
  noteTexts: string[];
};

const DEFAULT_TOKEN_BUDGET = 6_000;
const ELLIPSIS = '……（中间内容因长度限制已省略）';

/** 保守 token 估算：中文约 1 字 ≈ 1 token，取 length/1.5 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1_000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatTextBlockLocation(ref: unknown): string | null {
  const parsed = contentRefSchema.safeParse(ref);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (value.type === 'video') {
    const timestampSec = value.timestampSec;
    return `视频画面 timestampSec=${timestampSec}（${formatTimestamp(timestampSec * 1_000)}）`;
  }
  if (value.type === 'document') {
    return `文档页 page=${value.page}${value.blockIndex === undefined ? '' : ` blockIndex=${value.blockIndex}`}`;
  }
  return null;
}

/**
 * 超预算时保首尾、删中间：前半与后半各占一半预算，中间以省略号替代。
 */
export function truncateSections(
  sections: string[],
  budgetTokens: number,
): { sections: string[]; truncated: boolean } {
  const total = sections.reduce((sum, s) => sum + estimateTokens(s), 0);
  if (total <= budgetTokens) return { sections, truncated: false };

  const half = Math.floor(budgetTokens / 2);
  const head: string[] = [];
  let headTokens = 0;
  for (const section of sections) {
    const tokens = estimateTokens(section);
    if (headTokens + tokens > half) break;
    head.push(section);
    headTokens += tokens;
  }

  const tail: string[] = [];
  let tailTokens = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(sections[i]);
    if (tailTokens + tokens > half) break;
    tail.unshift(sections[i]);
    tailTokens += tokens;
  }

  const tailStart = sections.length - tail.length;
  const keepTail = tailStart > head.length ? tail : [];

  return { sections: [...head, ELLIPSIS, ...keepTail], truncated: true };
}

export async function buildStructuredContext(
  contentId: string,
  budgetTokens = DEFAULT_TOKEN_BUDGET,
  videoWindow?: { startSec: number; endSec: number },
): Promise<StructuredContext> {
  if (videoWindow && (!Number.isFinite(videoWindow.startSec) || !Number.isFinite(videoWindow.endSec)
    || videoWindow.startSec < 0 || videoWindow.endSec <= videoWindow.startSec)) throw new Error('Invalid video context window');
  const [transcripts, textBlocks, notes] = await Promise.all([
    prisma.transcriptSegment.findMany({ where: { contentId, ...(videoWindow ? {
      startMs: { gte: videoWindow.startSec * 1000, lt: videoWindow.endSec * 1000 },
    } : {}) }, orderBy: { seq: 'asc' } }),
    prisma.textBlock.findMany({ where: { contentId, ...(videoWindow ? { AND: [
      { ref: { path: ['type'], equals: 'video' } },
      { ref: { path: ['timestampSec'], gte: videoWindow.startSec, lt: videoWindow.endSec } },
    ] } : {}) }, orderBy: { sequence: 'asc' } }),
    videoWindow ? Promise.resolve([]) : prisma.note.findMany({ where: { contentId }, orderBy: { createdAt: 'asc' } }),
  ]);

  const sections: string[] = [];
  const refsBySection = new Map<string, ContentRef>();
  const textBySection = new Map<string, string>();
  for (const t of transcripts) {
    const timestampSec = Math.floor(t.startMs / 1000);
    const valid = Number.isFinite(t.startMs) && t.startMs >= 0;
    const section = `[转写 ${formatTimestamp(t.startMs)}${valid ? ` 视频转写 timestampSec=${timestampSec}` : ''}] ${t.text}`;
    sections.push(section);
    if (valid) {
      refsBySection.set(section, { type: 'video', timestampSec });
      textBySection.set(section, t.text);
    }
  }
  for (const b of textBlocks) {
    const location = formatTextBlockLocation(b.ref);
    sections.push(`[文本块 ${b.source}${location ? ` ${location}` : ''}] ${b.text}`);
    const parsed = contentRefSchema.safeParse(b.ref);
    if (parsed.success) {
      const section = sections[sections.length - 1];
      refsBySection.set(section, parsed.data);
      textBySection.set(section, b.text);
    }
  }
  for (const n of notes) sections.push(`[学习者笔记] ${n.content}`);

  const { sections: kept, truncated } = truncateSections(sections, budgetTokens);

  return {
    text: kept.join('\n'),
    stats: {
      transcriptCount: transcripts.length,
      textBlockCount: textBlocks.length,
      noteCount: notes.length,
    },
    truncated,
    sourceRefs: kept.flatMap((section) => { const ref = refsBySection.get(section); return ref ? [ref] : []; }),
    sourceSegments: kept.flatMap((section) => {
      const ref = refsBySection.get(section);
      const text = textBySection.get(section);
      return ref && text !== undefined ? [{ ref, text }] : [];
    }),
    noteTexts: kept.filter((section) => section.startsWith('[学习者笔记] ')).map((section) => section.slice('[学习者笔记] '.length)),
  };
}

/** At most 36 sequential model windows; refs always retain global video time. */
export function knowledgeVideoWindows(durationSec: number): { startSec: number; endSec: number }[] {
  if (!Number.isFinite(durationSec) || durationSec <= 300) return [];
  const width = Math.max(300, Math.ceil(durationSec / 36));
  const count = Math.ceil(durationSec / width);
  return Array.from({ length: count }, (_, index): { startSec: number; endSec: number } => ({
    startSec: index * width, endSec: index === count - 1 ? Math.ceil(durationSec * 1000 + 1) / 1000 : (index + 1) * width,
  }));
}
