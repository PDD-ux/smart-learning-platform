import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { z } from 'zod';

import { ErrorCode } from '@/lib/api/errors';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { assertOwnership } from '@/lib/auth/ownership';
import { getClientIp } from '@/lib/api/rate-limit';
import { recordAudit } from '@/lib/audit/audit-service';
import { compareNotes, toNoteItem } from '@/lib/domain/note-mapper';
import { prisma } from '@/lib/prisma';
import { getStorage, StorageError } from '@/lib/storage';

const exportSchema = z.object({ format: z.enum(['markdown', 'txt']) });

function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function locationLabel(ref: ReturnType<typeof toNoteItem>['ref']): string {
  if (ref.type === 'video') return formatTimestamp(ref.timestampSec);
  return `第 ${ref.page} 页${ref.blockIndex === undefined ? '' : ` · 段落 ${ref.blockIndex + 1}`}`;
}

function renderExport(title: string, notes: ReturnType<typeof toNoteItem>[], format: 'markdown' | 'txt'): string {
  if (format === 'markdown') {
    const sections = notes.map((note) => `## ${locationLabel(note.ref)}\n\n${note.content}`);
    return [`# ${title}`, ...sections].join('\n\n').trimEnd() + '\n';
  }
  const sections = notes.map((note) => `[${locationLabel(note.ref)}]\n${note.content}`);
  return [`${title}`, ...sections].join('\n\n').trimEnd() + '\n';
}

export const POST = withAuth<{ params: { id: string } }>(async (request: NextRequest, { user, params }): Promise<Response> => {
  const content = await prisma.learningContent.findUnique({ where: { id: params.id } });
  if (!content) return fail(ErrorCode.CONTENT_NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  assertOwnership(content.ownerId, user);

  const parsed = exportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_FAILED, '导出格式仅支持 markdown 或 txt', HttpStatus.BAD_REQUEST, parsed.error.flatten().fieldErrors);
  }

  const notes = (await prisma.note.findMany({ where: { contentId: content.id, ownerId: user.id } }))
    .map(toNoteItem)
    .sort(compareNotes);
  const { format } = parsed.data;
  const extension = format === 'markdown' ? 'md' : 'txt';
  const fileName = `learning-notes.${extension}`;
  const storageKey = `contents/${content.id}/exports/${randomUUID()}.${extension}`;
  const storage = getStorage();

  try {
    await storage.putObject(storageKey, Buffer.from(renderExport(content.title, notes, format), 'utf8'), {
      contentType: format === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
    });
    const download = await storage.createReadUrl(storageKey, { expiresInSec: 900, downloadFileName: fileName });
    await recordAudit({
      actorId: user.id,
      objectId: content.id,
      action: 'note.export',
      result: 'success',
      ip: getClientIp(request),
      detail: JSON.stringify({ format, noteCount: notes.length }),
    });
    return ok({ downloadUrl: download.url, expiresInSec: download.expiresInSec, fileName }, '笔记导出已生成');
  } catch (error) {
    await storage.deleteObject(storageKey).catch(() => undefined);
    // eslint-disable-next-line no-console
    console.error('[note-export] failed', {
      contentId: content.id,
      code: error instanceof StorageError ? error.code : 'UNKNOWN',
    });
    return fail(ErrorCode.EXPORT_FAILED, '笔记导出失败，请稍后重试', HttpStatus.INTERNAL);
  }
});
