'use client';

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { useEffect, useMemo, type ReactElement } from 'react';

import { createGraphLayout, type GraphCanvasNode } from '@/lib/domain/graph-layout';
import type { ContentGraph, GraphOverview } from '@/services/api';
import { graphNodeType } from '@/lib/domain/graph-presentation';

function KnowledgeNode({ data, selected }: NodeProps<GraphCanvasNode>): ReactElement {
  const scoreLabel = data.hasRecord ? `${Math.round(data.mastery * 100)}%` : '暂无记录';
  const masteryTier = !data.hasRecord ? 'unknown' : data.mastery >= 0.8 ? 'mastered' : data.mastery >= 0.6 ? 'steady' : 'learning';
  return <>
    <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
    <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
    <div
    className={`graph-canvas-node is-${masteryTier} ${data.hasRecord && data.isWeak ? 'is-weak' : ''} ${selected ? 'is-selected' : ''}`}
    role="group"
    aria-label={`${data.title}，掌握度 ${scoreLabel}${data.isWeak ? '，薄弱点' : ''}`}
    title={`${data.title} · 掌握度 ${scoreLabel}`}
  >
    <span className="graph-node-count">{graphNodeType(data.nodeType as 'concept' | 'formula' | 'method' | 'theorem')}</span>
    <span className="graph-node-title">{data.title}</span>
    <span className="graph-node-score">{data.status}{data.hasRecord ? ` · ${scoreLabel}` : ''}</span>
    {data.pointCount > 1 ? <span className="graph-node-count">合并 {data.pointCount} 项</span> : null}
  </div>
  </>;
}

const nodeTypes: NodeTypes = { knowledge: KnowledgeNode };

type GraphCanvasProps = {
  graph: GraphOverview | ContentGraph;
  onNodeClick: (pointId: string) => void;
  selectedPointId?: string;
};

function minimapNodeColor(node: GraphCanvasNode): string {
  if (!node.data.hasRecord) return '#c7c2b7';
  if (node.data.isWeak) return '#ec6d66';
  if (node.data.mastery >= 0.8) return '#4d7cfe';
  if (node.data.mastery >= 0.6) return '#27b89a';
  return '#f4bd4f';
}

export function GraphCanvas({ graph, onNodeClick, selectedPointId = '' }: GraphCanvasProps): ReactElement {
  const layout = useMemo(() => createGraphLayout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphCanvasNode>(layout.nodes);
  useEffect(() => { setNodes(layout.nodes); }, [layout, setNodes]);
  useEffect(() => { setNodes((current) => current.map((node) => ({ ...node, selected: node.id === selectedPointId }))); }, [selectedPointId, layout, setNodes]);
  const noNodes = layout.nodes.length === 0;

  return <div className="graph-canvas-wrap">
    {noNodes ? <div className="graph-canvas-empty">
      <span aria-hidden="true">✦</span>
      <strong>还没有可展示的图谱</strong>
      <p>导入资料并完成知识点解析后，图谱会显示在这里。</p>
    </div> : <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={layout.edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_event, node) => onNodeClick(node.id)}
      fitView
      fitViewOptions={{ padding: 0.24, maxZoom: 1.25 }}
      minZoom={0.25}
      maxZoom={1.8}
      nodesConnectable={false}
      nodesDraggable
      elementsSelectable
      aria-label="知识图谱画布"
    >
      <Background color="#e7dece" gap={24} size={1} />
      <MiniMap nodeColor={minimapNodeColor} maskColor="rgba(255, 249, 240, .72)" />
      <Controls showInteractive={false} />
    </ReactFlow>}
  </div>;
}
