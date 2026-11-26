import React, { useMemo } from 'react';

export interface GraphNode {
  id: string;
  node_type: 'email' | 'sender_domain' | 'reply_to' | 'url_domain' | 'attachment_hash' | 'campaign';
  label: string;
  risk_score: number;
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relation: string;
  weight?: number;
}

interface ThreatGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId?: string;
}

const NODE_COLORS: Record<GraphNode['node_type'], string> = {
  email: '#6366f1',
  sender_domain: '#06b6d4',
  reply_to: '#f59e0b',
  url_domain: '#ef4444',
  attachment_hash: '#ec4899',
  campaign: '#a855f7'
};

export const ThreatGraph: React.FC<ThreatGraphProps> = ({ nodes, edges, centerId }) => {
  const layout = useMemo(() => {
    const width = 620;
    const height = 340;
    const cx = width / 2;
    const cy = height / 2;

    const positioned = new Map<string, { x: number; y: number; node: GraphNode }>();
    const center = nodes.find((n) => n.id === centerId) || nodes[0];
    if (!center) return { width, height, positioned, edges: [] as GraphEdge[] };

    positioned.set(center.id, { x: cx, y: cy, node: center });
    const others = nodes.filter((n) => n.id !== center.id);
    const radius = 122;

    others.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, others.length) - Math.PI / 2;
      positioned.set(n.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        node: n
      });
    });

    return { width, height, positioned, edges };
  }, [nodes, edges, centerId]);

  if (nodes.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500 text-sm border border-slate-800 rounded-xl bg-slate-900/40">
        Select an incident to inspect its 2-hop Threat Provenance Graph.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">Heterogeneous Threat Provenance Graph</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <span key={type} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {type}
            </span>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-72 bg-slate-950/70 rounded-lg">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="18" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#475569" />
          </marker>
        </defs>

        {layout.edges.map((e, i) => {
          const s = layout.positioned.get(e.source_id);
          const t = layout.positioned.get(e.target_id);
          if (!s || !t) return null;
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;
          return (
            <g key={`${e.source_id}-${e.target_id}-${i}`}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="#475569"
                strokeWidth="1.5"
                markerEnd="url(#arrow)"
              />
              <text x={mx} y={my - 4} textAnchor="middle" fill="#94a3b8" fontSize="8.5" className="font-mono">
                {e.relation}
              </text>
            </g>
          );
        })}

        {Array.from(layout.positioned.values()).map(({ x, y, node }) => {
          const color = NODE_COLORS[node.node_type] || '#64748b';
          const isCenter = node.id === centerId;
          return (
            <g key={node.id} transform={`translate(${x}, ${y})`}>
              <circle
                r={isCenter ? 20 : 15}
                fill={color}
                fillOpacity={0.22}
                stroke={color}
                strokeWidth={isCenter ? 2.5 : 1.8}
              />
              <text y={3} textAnchor="middle" fill="#f8fafc" fontSize="9" fontWeight="bold">
                {node.risk_score}
              </text>
              <text y={isCenter ? 32 : 27} textAnchor="middle" fill="#cbd5e1" fontSize="9.5" className="font-mono">
                {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
