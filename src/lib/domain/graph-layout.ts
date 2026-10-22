import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { ContentGraph, GraphOverview } from '@/services/api';
import { graphStatus, hasGraphLearningRecord } from './graph-presentation';

export type GraphCanvasNodeData = {
  title: string;
  status: string;
  hasRecord: boolean;
  nodeType: string;
  mastery: number;
  isWeak: boolean;
  pointCount: number;
  weakPointCount: number;
};

export type GraphCanvasNode = Node<GraphCanvasNodeData, 'knowledge'>;

function relationLabel(relation: string): string {
  if (relation === 'prerequisite') return '前置';
  if (relation === 'example_of') return '举例';
  return '相关';
}

export function createGraphLayout(graph: GraphOverview | ContentGraph): {
  nodes: GraphCanvasNode[];
  edges: Edge[];
} {
  const nodes: GraphCanvasNode[] = graph.nodes.map((node, index) => {
    const pointCount = 'pointIds' in node ? node.pointIds.length : 1;
    const weakPointCount = 'weakPointCount' in node ? node.weakPointCount : Number(node.isWeak);
    const columns = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));
    return {
      id: node.pointId,
      type: 'knowledge',
      position: {
        x: (index % columns) * 280,
        y: Math.floor(index / columns) * 190,
      },
      data: {
        title: node.title,
        status: graphStatus(node),
        hasRecord: hasGraphLearningRecord(node),
        nodeType: node.nodeType,
        mastery: node.mastery,
        isWeak: node.isWeak,
        pointCount,
        weakPointCount,
      },
      style: { width: 208, height: 120 },
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeRows = graph.edges.flatMap((edge, index) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) return [];
    const relation = edge.relation;
    const related = relation === 'related';
    return [{
      id: `${edge.source}-${edge.target}-${relation}-${index}`,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: relationLabel(relation),
      markerEnd: related ? undefined : { type: MarkerType.ArrowClosed, color: '#899783' },
      labelStyle: { fill: '#6f7b8c', fontSize: 11 },
      style: {
        stroke: related ? '#b4b0a5' : '#899783',
        strokeWidth: Math.max(1, Math.min(3, edge.weight * 3)),
        strokeDasharray: related ? '6 5' : undefined,
      },
    } satisfies Edge];
  });

  return { nodes, edges: edgeRows };
}
