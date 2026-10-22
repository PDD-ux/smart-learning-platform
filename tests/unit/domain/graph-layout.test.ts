import { describe, expect, it } from 'vitest';

import { createGraphLayout } from '@/lib/domain/graph-layout';
import type { GraphOverview } from '@/services/api';

const graph: GraphOverview = {
  nodes: [
    {
      pointId: 'p1',
      title: '函数',
      nodeType: 'concept',
      pointIds: ['p1', 'p2'],
      contentIds: ['c1', 'c2'],
      aliases: ['函数关系'],
      mastery: 0.6,
      isWeak: true,
      weakPointCount: 1,
      reviewCount: 2,
      correctRate: 0.8,
      relatedNoteCount: 1,
      relatedFlashcardCount: 3,
      lastReviewedAt: '2026-10-01T10:00:00.000Z',
    },
    {
      pointId: 'p3',
      title: '导数',
      nodeType: 'formula',
      pointIds: ['p3'],
      contentIds: ['c1'],
      aliases: [],
      mastery: 0.9,
      isWeak: false,
      weakPointCount: 0,
      reviewCount: 0,
      correctRate: null,
      relatedNoteCount: 0,
      relatedFlashcardCount: 0,
      lastReviewedAt: null,
    },
  ],
  edges: [{ source: 'p1', target: 'p3', relation: 'prerequisite', weight: 0.75, contentIds: ['c1'] }],
  summary: { contentCount: 2, nodeCount: 2, weakPointCount: 1, edgeCount: 1 },
};

describe('createGraphLayout', () => {
  it('keeps readable card sizes and real relationship directions without encoding mastery in size', () => {
    const layout = createGraphLayout(graph);
    const weakNode = layout.nodes.find((node) => node.id === 'p1');

    expect(weakNode?.data).toMatchObject({ title: '函数', mastery: 0.6, isWeak: true, pointCount: 2, weakPointCount: 1 });
    expect(weakNode?.style).toEqual({ width: 208, height: 120 });
    expect(layout.nodes.find((node) => node.id === 'p3')?.data).toMatchObject({ hasRecord: false, status: '暂无学习记录' });
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ source: 'p1', target: 'p3', label: '前置' });
    expect(layout.edges[0]?.markerEnd).toBeTruthy();
    expect(layout.nodes[0]?.position).not.toEqual(layout.nodes[1]?.position);
  });
  it('separates all card bounding boxes in a larger map without adding relationships', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({ ...graph.nodes[0]!, pointId: 'point-' + index }));
    const result = createGraphLayout({ nodes, edges: [] });
    expect(result.edges).toEqual([]);
    for (const [i, left] of result.nodes.entries()) for (const right of result.nodes.slice(i + 1)) {
      expect(Math.abs(left.position.x - right.position.x) >= 208 || Math.abs(left.position.y - right.position.y) >= 120).toBe(true);
    }
  });

  it('drops edges whose endpoints are not included in the graph', () => {
    const layout = createGraphLayout({
      nodes: graph.nodes,
      edges: [{ source: 'missing', target: 'p3', relation: 'related', weight: 1 }],
    });
    expect(layout.edges).toEqual([]);
  });
});
