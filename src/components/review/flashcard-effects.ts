import type { Rating } from '@/lib/domain/sm2';

/** 评分=3 时给复习卡追加 celebrate class，视觉动画由 globals.css 提供。 */
export function flashcardClassName(baseClassName: string, rating?: Rating): string {
  return rating === 3 ? `${baseClassName} celebrate` : baseClassName;
}
