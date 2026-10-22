import type { Note } from '@prisma/client';

import { contentRefSchema, refSortKey, type ContentRef } from './content-ref';

/**
 * 笔记映射（tasks.md §4.2）
 * ------------------------------------------------------------
 * Prisma Note 行 → API 契约 NoteItem（spec/03-ARCHITECTURE.md §2.2.2）。
 */

export type NoteItem = {
  noteId: string;
  contentId: string;
  content: string;
  ref: ContentRef;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function toNoteItem(note: Note): NoteItem {
  return {
    noteId: note.id,
    contentId: note.contentId,
    content: note.content,
    ref: contentRefSchema.parse(note.ref),
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** 笔记排序：视频按 timestampSec、文档按 page + blockIndex，再按创建时间 */
export function compareNotes(a: NoteItem, b: NoteItem): number {
  const keyA = refSortKey(a.ref);
  const keyB = refSortKey(b.ref);
  if (keyA !== keyB) return keyA - keyB;

  const blockA = a.ref.type === 'document' ? a.ref.blockIndex ?? 0 : 0;
  const blockB = b.ref.type === 'document' ? b.ref.blockIndex ?? 0 : 0;
  if (blockA !== blockB) return blockA - blockB;

  return a.createdAt.localeCompare(b.createdAt);
}
