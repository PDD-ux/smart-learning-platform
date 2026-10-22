import { ContentStatus, UnderstandStatus } from '@prisma/client';

/**
 * 内容状态标签映射（tasks.md §3.2）
 * ------------------------------------------------------------
 * 数据库用枚举（PENDING/UPLOADING/...），API 契约对外返回中文标签
 * （spec/03-ARCHITECTURE.md §2.2.2 ContentSummary.status）。
 */

export type ContentStatusLabel = '待导入' | '上传中' | '解析中' | '已就绪' | '失败';
export type UnderstandStatusLabel = 'none' | 'running' | 'completed' | 'failed';

const CONTENT_STATUS_LABELS: Record<ContentStatus, ContentStatusLabel> = {
  [ContentStatus.PENDING]: '待导入',
  [ContentStatus.UPLOADING]: '上传中',
  [ContentStatus.PARSING]: '解析中',
  [ContentStatus.READY]: '已就绪',
  [ContentStatus.FAILED]: '失败',
};

const UNDERSTAND_STATUS_LABELS: Record<UnderstandStatus, UnderstandStatusLabel> = {
  [UnderstandStatus.NONE]: 'none',
  [UnderstandStatus.RUNNING]: 'running',
  [UnderstandStatus.COMPLETED]: 'completed',
  [UnderstandStatus.FAILED]: 'failed',
};

export function contentStatusLabel(status: ContentStatus): ContentStatusLabel {
  return CONTENT_STATUS_LABELS[status];
}

export function understandStatusLabel(status: UnderstandStatus): UnderstandStatusLabel {
  return UNDERSTAND_STATUS_LABELS[status];
}
