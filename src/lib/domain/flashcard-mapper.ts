import { CardType, type Flashcard } from '@prisma/client';

/**
 * 闪卡接口 DTO 映射（tasks.md §7.2）
 * ------------------------------------------------------------
 * Prisma 枚举使用大写值，API 契约使用小写标签；日期统一输出 ISO 字符串。
 */

export type FlashcardStatus = 'new' | 'learning' | 'review' | 'graduated';
export type FlashcardCardType = 'qa' | 'cloze' | 'formula';

export type FlashcardItem = {
  flashcardId: string;
  contentId: string;
  pointId: string | null;
  contentTitle: string | null;
  pointTitle: string | null;
  cardType: FlashcardCardType;
  front: string;
  back: string;
  hint: string | null;
  status: FlashcardStatus;
  nextReviewAt: string;
  easeFactor: number;
  intervalDays: number;
};

const cardTypeLabels: Record<CardType, FlashcardCardType> = {
  QA: 'qa',
  CLOZE: 'cloze',
  FORMULA: 'formula',
};

export function cardStatusLabel(status: Flashcard['status']): FlashcardStatus {
  return status.toLowerCase() as FlashcardStatus;
}

export function toFlashcardItem(card: Flashcard & { content?: { title: string }; point?: { title: string; ownerId: string; contentId: string } | null }): FlashcardItem {
  return {
    flashcardId: card.id,
    contentId: card.contentId,
    pointId: card.pointId,
    contentTitle: card.content?.title ?? null,
    pointTitle: card.point?.ownerId === card.ownerId && card.point.contentId === card.contentId ? card.point.title : null,
    cardType: cardTypeLabels[card.cardType],
    front: card.front,
    back: card.back,
    hint: card.hint,
    status: cardStatusLabel(card.status),
    nextReviewAt: card.nextReviewAt.toISOString(),
    easeFactor: card.easeFactor,
    intervalDays: card.intervalDays,
  };
}
