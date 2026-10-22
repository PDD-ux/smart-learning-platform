import type { GraphNode } from '@/services/api';

export function hasGraphLearningRecord(node: Pick<GraphNode, 'reviewCount' | 'correctRate' | 'lastReviewedAt'>): boolean {
  return node.reviewCount > 0 || node.correctRate !== null || node.lastReviewedAt !== null;
}

export function graphStatus(node: GraphNode): string {
  if (!hasGraphLearningRecord(node)) return '暂无学习记录';
  if (node.isWeak || node.mastery < 0.6) return '待补强';
  return node.mastery >= 0.8 ? '较熟悉' : '待巩固';
}

export function graphNodeType(type: GraphNode['nodeType']): string {
  return { concept: '概念', formula: '公式', method: '方法', theorem: '定理' }[type];
}
