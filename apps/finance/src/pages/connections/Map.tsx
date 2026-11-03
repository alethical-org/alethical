import { useEffect, useId, useRef, useState } from 'react';
import { edgeAmount, nodeKind, RELATIONSHIPS, type GraphEdge, type GraphNode } from './data';

/** Wrap using the rendered font's width, including one long word. No label is shortened. */
export function wrapLabel(
  label: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of label.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const char of word) {
      if (line && measure(line + char) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
const heads = ['Giving and representation', 'Committees and registrations', 'Recipients'];
export function ConnectionsMap({
  nodes,
  edges,
  selectedNode,
  selectedEdge,
  onNode,
  onEdge,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: string;
  selectedEdge: string;
  onNode: (key: string) => void;
  onEdge: (id: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [fontReady, setFontReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const marker = useId().replaceAll(':', '');
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) setFontReady(true);
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d');
  if (ctx) ctx.font = '600 12.5px Inter, sans-serif';
  const measure = (s: string) => ctx?.measureText(s).width ?? s.length * 8;
  const stacked = width < 600,
    pad = 16,
    gap = 56,
    indent = 22;
  const boxWidth = stacked
    ? width - pad * 2 - indent * 2
    : Math.floor((width - pad * 2 - gap * 2) / 3);
  const columns: GraphNode[][] = [[], [], []];
  for (const node of nodes) {
    const middle =
      node.kind === 'committee' ||
      node.kind === 'principal' ||
      edges.some((e) => e.to === node.key && e.relationship === 'lobbying_representation');
    columns[middle ? 1 : edges.some((e) => e.from === node.key) ? 0 : 2].push(node);
  }
  columns.forEach((col) => col.sort((a, b) => a.label.localeCompare(b.label)));
  const positions = new Map<string, { x: number; y: number; height: number; lines: string[] }>();
  const labels: Array<{ x: number; y: number; lines: string[] }> = [];
  let height = 0,
    top = 8;
  columns.forEach((col, index) => {
    if (!col.length) return;
    const x = pad + index * (stacked ? indent : boxWidth + gap);
    const title = wrapLabel(heads[index], boxWidth, measure);
    let y = stacked ? top : 8;
    labels.push({ x, y: y + 14, lines: title });
    y += 12 + title.length * 16;
    col.forEach((node) => {
      const lines = wrapLabel(node.label, boxWidth - 42, measure);
      const h = Math.max(44, 12 + lines.length * 16 + (node.unresolved ? 16 : 0));
      positions.set(node.key, { x, y, height: h, lines });
      y += h + 10;
    });
    top = y + 10;
    height = Math.max(height, y);
  });
  const active = (edge: GraphEdge) =>
    edge.id === selectedEdge ||
    Boolean(selectedNode && (edge.from === selectedNode || edge.to === selectedNode));
  const related = (node: GraphNode) =>
    (!selectedNode && !selectedEdge) ||
    node.key === selectedNode ||
    edges.some((e) => active(e) && (e.from === node.key || e.to === node.key));
  const hovered = nodes.find((node) => node.key === hover);
  const hoveredEdges = hovered
    ? edges.filter((e) => e.from === hovered.key || e.to === hovered.key)
    : [];
  return (
    <div className="mc-map" ref={holder} data-font-ready={fontReady}>
      <svg
        width={width}
        height={height + 16}
        viewBox={`0 0 ${width} ${height + 16}`}
        role="group"
        aria-label="Map of the connections listed in the table"
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#5F6B76" />
          </marker>
        </defs>
        {labels.map((label, i) => (
          <text key={i} x={label.x} y={label.y} className="mc-map-heading">
            {label.lines.map((line, j) => (
              <tspan key={j} x={label.x} dy={j ? 16 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        ))}
        {edges.map((edge) => {
          const a = positions.get(edge.from),
            b = positions.get(edge.to);
          if (!a || !b) return null;
          const ya = a.y + 15,
            yb = b.y + 15;
          const forward = a.x < b.x,
            x1 = a.x + (forward ? boxWidth : 0),
            x2 = b.x + (forward ? 0 : boxWidth),
            mid = (x1 + x2) / 2;
          const loopLeft = a.x + boxWidth + 40 >= width - pad;
          const loopX = loopLeft ? a.x : a.x + boxWidth;
          const curveX = loopX + (loopLeft ? -40 : 40);
          const d = stacked
            ? `M${a.x},${ya} C6,${ya} 6,${yb} ${b.x},${yb}`
            : a.x === b.x
              ? `M${loopX},${ya} C${curveX},${ya} ${curveX},${yb} ${loopX},${yb}`
              : `M${x1},${ya} C${mid},${ya} ${mid},${yb} ${x2},${yb}`;
          const from = nodes.find((n) => n.key === edge.from),
            to = nodes.find((n) => n.key === edge.to);
          return (
            <g
              key={edge.id}
              className="mc-edge"
              data-selected={active(edge) || undefined}
              data-dim={((selectedNode || selectedEdge) && !active(edge)) || undefined}
              data-no-amount={edge.amount_state === 'not_applicable' || undefined}
            >
              <path className="mc-edge-line" d={d} markerEnd={`url(#${marker})`} />
              <path
                className="mc-edge-hit"
                d={d}
                role="button"
                tabIndex={0}
                aria-pressed={edge.id === selectedEdge}
                aria-label={`${from?.label}, ${RELATIONSHIPS[edge.relationship] ?? edge.relationship}, ${to?.label}`}
                onClick={() => onEdge(edge.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEdge(edge.id);
                  }
                }}
              />
            </g>
          );
        })}
        {nodes.map((node) => {
          const p = positions.get(node.key)!;
          return (
            <g
              key={node.key}
              className="mc-node"
              data-selected={selectedNode === node.key || undefined}
              data-committee={node.kind === 'committee' || undefined}
              data-printed={node.unresolved || undefined}
              data-dim={!related(node) || undefined}
              transform={`translate(${p.x},${p.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${node.label}, ${nodeKind(node)}`}
              aria-pressed={selectedNode === node.key}
              onClick={() => onNode(node.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNode(node.key);
                }
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') setHover(node.key);
              }}
              onPointerLeave={() => setHover(null)}
            >
              <rect
                className="mc-node-focus"
                x={-4}
                y={-4}
                width={boxWidth + 8}
                height={p.height + 8}
                rx={9}
              />
              <rect className="mc-node-box" width={boxWidth} height={p.height} rx={6} />
              <g aria-hidden="true" transform="translate(8,7)">
                <rect
                  width={18}
                  height={18}
                  rx={node.kind === 'person' ? 9 : 4}
                  fill="#EAF4F7"
                  stroke={node.unresolved ? '#5F6B76' : 'none'}
                  strokeDasharray={node.unresolved ? '2 2' : undefined}
                />
                {node.unresolved ? (
                  <text x={9} y={12.5} textAnchor="middle" fontSize={8.5} fill="#4A5661">
                    Aa
                  </text>
                ) : (
                  <path
                    transform="translate(2,2) scale(.6)"
                    d={
                      node.kind === 'committee'
                        ? 'M4 10 H20 V20 H4 Z M8 10 V6 H16 V10 M9 14 H15'
                        : /person|lobbyist|candidate|legislator/.test(node.kind)
                          ? 'M12 12 a4 4 0 1 0 0-8 a4 4 0 1 0 0 8 M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21'
                          : node.kind === 'file'
                            ? 'M6 3 H15 L19 7 V21 H6 Z M9 12 H16 M9 16 H14'
                            : 'M5 3 H19 V21 H5 Z M9 8 H10 M14 8 H15 M9 12 H10 M14 12 H15 M10 21 V17 H14 V21'
                    }
                    fill="none"
                    stroke="#0B5C72"
                    strokeWidth={2}
                  />
                )}
              </g>
              {p.lines.map((line, i) => (
                <text key={i} x={32} y={19.5 + i * 16} className="mc-node-label">
                  {line}
                </text>
              ))}
              {node.unresolved && (
                <text x={32} y={19.5 + p.lines.length * 16} className="mc-node-printed">
                  PRINTED
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="mc-map-tip"
          role="tooltip"
          style={{
            left: Math.max(4, Math.min(positions.get(hovered.key)!.x + 12, width - 240)),
            top: Math.max(
              4,
              positions.get(hovered.key)!.y + positions.get(hovered.key)!.height + 8,
            ),
          }}
        >
          <strong>{hovered.label}</strong>
          <span>
            {nodeKind(hovered)} · {hoveredEdges.length}{' '}
            {hoveredEdges.length === 1 ? 'connection' : 'connections'}
          </span>
          {hoveredEdges.length === 1 && edgeAmount(hoveredEdges[0]) && (
            <span>{edgeAmount(hoveredEdges[0])}</span>
          )}
        </div>
      )}
    </div>
  );
}
