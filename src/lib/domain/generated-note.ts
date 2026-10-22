import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { contentRefSchema, type ContentRef } from '@/lib/domain/content-ref';

function formatRef(ref: ContentRef): string {
  if (ref.type === 'document') return `第 ${ref.page} 页`;
  const minutes = Math.floor(ref.timestampSec / 60);
  const seconds = String(ref.timestampSec % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function firstReference(refs: unknown): ContentRef | null {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  const result = contentRefSchema.safeParse(refs[0]);
  return result.success ? result.data : null;
}

/** 将深度理解阶段的知识点落成可读 Markdown；绝不读取或覆盖学习者的 Note。 */
export async function generateStructuredNote(contentId: string, db: Pick<Prisma.TransactionClient, 'knowledgePoint' | 'generatedNote'> = prisma): Promise<void> {
  const points = await db.knowledgePoint.findMany({
    where: { contentId },
    orderBy: [{ importance: 'desc' }, { createdAt: 'asc' }],
  });
  if (points.length === 0) return;

  if (points.every((point): boolean => firstReference(point.refs)?.type === 'document')) {
    points.sort((a, b): number => {
      const left = firstReference(a.refs); const right = firstReference(b.refs);
      return left?.type === 'document' && right?.type === 'document' ? left.page - right.page : 0;
    });
  }

  const markdown = [
    '# AI 整理笔记',
    '',
    '> 由本资料的解析知识点自动整理。你的“实时笔记”独立保存，不会被覆盖。',
    '',
    ...points.flatMap((point, index) => {
      const reference = firstReference(point.refs);
      return [
        `## ${index + 1}. ${point.title}`,
        '',
        point.summary,
        reference ? `来源：${formatRef(reference)}` : '来源：当前解析资料',
        point.tags.length ? `标签：${point.tags.map((tag) => `#${tag}`).join(' ')}` : '',
        '',
      ];
    }),
  ].filter(Boolean).join('\n');

  await db.generatedNote.upsert({
    where: { contentId },
    create: { contentId, markdown, sourceCount: points.length },
    update: { markdown, sourceCount: points.length },
  });
}
