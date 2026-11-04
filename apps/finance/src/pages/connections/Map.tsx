import { quotedSpelling } from '../payments/printedName';
import { useEffect, useId, useRef, useState } from 'react';
import {
  edgeAmount,
  nodeKind,
  nodeSub,
  RELATIONSHIPS,
  type GraphEdge,
  type GraphNode,
} from './data';

/** Wrap using the rendered font's width, including one long word. No label is shortened. */
export function wrapLabel(
  label: string,
  width: number,
  measure: (text: string) => number,
  preserveWhitespace = false,
): string[] {
  if (preserveWhitespace) {
    const lines: string[] = [];
    let line = '';
    for (const token of label.match(/\s+|\S+/g) ?? []) {
      if (line && measure(line + token) > width) {
        lines.push(line);
        line = '';
      }
      for (const char of token) {
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

const HEADS = ['Giving and representation', 'Committees and registrations', 'Recipients'];

/** The column a node sits in (Money connections map, 27 Oct): committees,
 * principals and represented organizations in the middle; givers on the left;
 * everyone else on the right. */
export function columnOf(node: GraphNode, edges: ReadonlyArray<GraphEdge>) {
  const middle =
    node.kind === 'committee' ||
    node.kind === 'principal' ||
    edges.some((e) => e.to === node.key && e.relationship === 'lobbying_representation');
  return middle ? 1 : edges.some((e) => e.from === node.key) ? 0 : 2;
}

const MARKS: Record<string, string> = {
  person: 'M12 12 a4 4 0 1 0 0-8 a4 4 0 1 0 0 8 M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21',
  org: 'M5 3 H19 V21 H5 Z M9 8 H10 M14 8 H15 M9 12 H10 M14 12 H15 M10 21 V17 H14 V21',
  cmte: 'M4 10 H20 V20 H4 Z M8 10 V6 H16 V10 M9 14 H15',
  filing: 'M6 3 H15 L19 7 V21 H6 Z M9 12 H16 M9 16 H14',
};
function markOf(node: GraphNode) {
  if (node.kind === 'committee') return 'cmte';
  if (/person|lobbyist|candidate|legislator/.test(node.kind)) return 'person';
  if (node.kind === 'file') return 'filing';
  return 'org';
}

/**
 * The map (Money connections map, 27 Oct; Round 34): fluid to its container,
 * 3 columns sharing the width, labels wrapping at 12.5px, the PRINTED tag on
 * its own line. Below a 600px container the columns stack with lines down the
 * left edge, so nothing is ever cropped; the box grows instead. Hover tints a
 * node, a press tints it on touch, selection is a 3px teal border and keyboard
 * focus a separate purple ring 4px outside.
 */
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
    const measure = () => setWidth(Math.max(280, el.clientWidth || 600));
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
  const measureWith = (font: string) => (s: string) => {
    if (!ctx) return s.length * 8;
    ctx.font = font;
    return ctx.measureText(s).width;
  };
  const measureLabel = measureWith('600 12.5px Inter, sans-serif');
  const measureSub = measureWith('400 11px Inter, sans-serif');
  const measureHead = measureWith('700 11px Inter, sans-serif');
  const stacked = width < 600,
    pad = 16,
    gap = 56,
    indent = 22;
  const boxWidth = stacked
    ? width - pad * 2 - indent * 2
    : Math.floor((width - pad * 2 - gap * 2) / 3);
  const columns: GraphNode[][] = [[], [], []];
  for (const node of nodes) columns[columnOf(node, edges)].push(node);
  columns.forEach((col) => col.sort((a, b) => a.label.localeCompare(b.label)));
  const positions = new Map<
    string,
    { x: number; y: number; height: number; lines: string[]; sub: string[] }
  >();
  const labels: Array<{ x: number; y: number; lines: string[] }> = [];
  let height = 0,
    top = 8;
  columns.forEach((col, index) => {
    if (!col.length) return;
    const x = pad + index * (stacked ? indent : boxWidth + gap);
    const title = wrapLabel(HEADS[index], boxWidth, measureHead);
    let y = stacked ? top : 8;
    labels.push({ x, y: y + 14, lines: title });
    y += 12 + title.length * 16;
    col.forEach((node) => {
      const lines = wrapLabel(
        node.unresolved ? quotedSpelling(node.label) : node.label,
        boxWidth - 42,
        measureLabel,
        node.unresolved,
      );
      const sub = wrapLabel(nodeSub(node), boxWidth - 42, measureSub, true);
      const natural = 12 + (lines.length + sub.length) * 16 + (node.unresolved ? 16 : 0);
      // A phone target is at least 44px tall (eug-8, the brief's touch rule).
      const h = stacked ? Math.max(44, natural) : natural;
      positions.set(node.key, { x, y, height: h, lines, sub });
      y += h + 10;
    });
    top = y + 10;
    height = Math.max(height, y);
  });
  height += 8;
  const active = (edge: GraphEdge) =>
    edge.id === selectedEdge ||
    Boolean(selectedNode && (edge.from === selectedNode || edge.to === selectedNode));
  const related = (node: GraphNode) =>
    (!selectedNode && !selectedEdge) ||
    node.key === selectedNode ||
    edges.some((e) => active(e) && (e.from === node.key || e.to === node.key));
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const hovered = hover ? byKey.get(hover) : undefined;
  const hoveredEdges = hovered
    ? edges.filter((e) => e.from === hovered.key || e.to === hovered.key)
    : [];
  const hoveredAt = hovered && positions.get(hovered.key);
  const single = hoveredEdges.length === 1 ? edgeAmount(hoveredEdges[0]) : '';
  return (
    <div className="mc-map" ref={holder} data-font-ready={fontReady}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
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
          const ya = a.y + Math.min(15, a.height / 2),
            yb = b.y + Math.min(15, b.height / 2);
          const forward = a.x < b.x,
            x1 = a.x + (forward ? boxWidth : 0),
            x2 = b.x + (forward ? 0 : boxWidth),
            mid = (x1 + x2) / 2;
          // A line between 2 names in 1 column loops outside it, on whichever
          // side has room, so it never leaves the drawing.
          const loopLeft = a.x + boxWidth + 40 >= width - pad;
          const loopX = loopLeft ? a.x : a.x + boxWidth;
          const curveX = loopX + (loopLeft ? -40 : 40);
          const d = stacked
            ? `M${a.x},${ya} C6,${ya} 6,${yb} ${b.x},${yb}`
            : a.x === b.x
              ? `M${loopX},${ya} C${curveX},${ya} ${curveX},${yb} ${loopX},${yb}`
              : `M${x1},${ya} C${mid},${ya} ${mid},${yb} ${x2},${yb}`;
          const from = byKey.get(edge.from),
            to = byKey.get(edge.to);
          const name = `${from?.label} · ${RELATIONSHIPS[edge.relationship] ?? edge.relationship} · ${to?.label}`;
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
                aria-label={name}
                onClick={() => onEdge(edge.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEdge(edge.id);
                  }
                }}
              >
                <title>{name}</title>
              </path>
            </g>
          );
        })}
        {nodes.map((node) => {
          const p = positions.get(node.key)!;
          const mark = markOf(node);
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
              {node.unresolved ? (
                <g aria-hidden="true">
                  <rect
                    x={8}
                    y={6}
                    width={18}
                    height={18}
                    rx={4}
                    fill="none"
                    stroke="rgba(20,27,34,0.45)"
                    strokeDasharray="2 2"
                  />
                  <text x={17} y={18.5} textAnchor="middle" className="mc-node-aa">
                    Aa
                  </text>
                </g>
              ) : (
                <g aria-hidden="true" transform="translate(8,6) scale(0.75)">
                  <rect
                    width={24}
                    height={24}
                    rx={mark === 'person' ? 12 : 5}
                    fill="#EAF4F7"
                    stroke={mark === 'cmte' ? '#0E6A82' : 'none'}
                    strokeWidth={1.3}
                  />
                  <g transform="translate(4.8,4.8) scale(0.6)">
                    <path
                      d={MARKS[mark]}
                      fill="none"
                      stroke="#0B5C72"
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                </g>
              )}
              {p.lines.map((line, i) => (
                <text key={i} x={32} y={19.5 + i * 16} className="mc-node-label">
                  {line}
                </text>
              ))}
              {p.sub.map((line, i) => (
                <text
                  key={`sub-${i}`}
                  x={32}
                  y={19.5 + (p.lines.length + i) * 16}
                  className="mc-node-sub"
                >
                  {line}
                </text>
              ))}
              {node.unresolved && (
                <text
                  x={32}
                  y={19.5 + (p.lines.length + p.sub.length) * 16}
                  className="mc-node-printed"
                >
                  PRINTED
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hoveredAt && (
        <div
          className="mc-map-tip"
          role="tooltip"
          // Above the name when there is room for a wrapped card, else below it;
          // the card is never cut by the map's box.
          style={
            hoveredAt.y >= 120
              ? {
                  left: Math.max(4, Math.min(hoveredAt.x + 12, width - 232)),
                  top: hoveredAt.y - 8,
                  transform: 'translateY(-100%)',
                }
              : {
                  left: Math.max(4, Math.min(hoveredAt.x + 12, width - 232)),
                  top: hoveredAt.y + hoveredAt.height + 8,
                }
          }
        >
          <strong>{hovered.label}</strong>
          <span>
            {nodeKind(hovered)} · {hoveredEdges.length}{' '}
            {hoveredEdges.length === 1 ? 'connection' : 'connections'}
          </span>
          {single && <b className="f-num">{single}</b>}
        </div>
      )}
    </div>
  );
}
