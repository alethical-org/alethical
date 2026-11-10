import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { GROUPS, namedPaths, nodeLabel, relationLabel, type Run } from './connections';

function curves(run: Run, frame: HTMLDivElement): string[] {
  const { left, top, width } = frame.getBoundingClientRect();
  if (!width) return [];
  const columnGap = parseFloat(getComputedStyle(frame).columnGap);
  const boxes = new Map(
    run.nodes.map(([id, column]) => {
      const node = frame.querySelector(`[data-node="${id}"]`)!;
      const label = node.querySelector('.lp-node-label')!;
      const text = label.getBoundingClientRect();
      const dot = node.querySelector('.lp-dot')?.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = Array.from(range.getClientRects());
      return [
        id,
        {
          column,
          right: node.getBoundingClientRect().right,
          text,
          textRight: lines.length
            ? dot
              ? lines[0].right
              : Math.max(...lines.map((line) => line.right))
            : text.right,
          dot,
          centerY: (dot ?? text).top + (dot ?? text).height / 2 - top,
        },
      ] as const;
    }),
  );
  const paths = new Set<string>();
  function connect(from: Run['nodes'][number][0], to: Run['nodes'][number][0]) {
    const a = boxes.get(from)!;
    const b = boxes.get(to)!;
    const y1 = a.centerY;
    const y2 = b.centerY;
    const x2 = (b.dot ?? b.text).left - left - 5;
    // Precinct results step down from the race dot within its column.
    if (a.column === b.column && a.dot) {
      const x = a.dot.left + a.dot.width / 2 - left;
      paths.add(`M${x} ${a.dot.bottom - top + 3} V${y2 - 8} Q${x} ${y2} ${x + 8} ${y2} H${x2}`);
      return;
    }
    const x1 = a.textRight - left + 8;
    // Stay on the source row until clear of the column, including wrapped
    // labels in adjacent rows. Skips stay on an empty row of the middle column.
    const gutter = b.column - a.column > 1 ? x2 + 5 - columnGap : a.right - left;
    const bend = Math.min(x2, Math.max(x1, gutter + 4));
    const middle = (bend + x2) / 2;
    paths.add(`M${x1} ${y1} H${bend} C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`);
  }
  for (const [from, to, via] of run.connections) {
    if (via) connect(from, via);
    connect(via ?? from, to);
  }
  return [...paths];
}

function RunDrawing({ run }: { run: Run }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const next = curves(run, frame);
      setPaths((old) => (old.join('|') === next.join('|') ? old : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [run]);

  return (
    <div
      className={`lp-run-drawing lp-run-drawing--${run.id}`}
      style={
        {
          '--run-columns': run.columns,
          '--run-fixed-rows': Math.max(...run.nodes.map(([, , row]) => row)) + 1,
        } as CSSProperties
      }
      ref={ref}
      aria-hidden="true"
    >
      <svg className="lp-lines" width="100%" height="100%" focusable="false">
        {paths.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
      {run.nodes.map(([id, column, row]) => {
        const relation = relationLabel(id);
        return (
          <div
            key={id}
            data-node={id}
            className={`lp-node${relation ? ' lp-node--relation' : ''}`}
            style={{ gridColumn: column + 1, gridRow: `${row + 1} / span 2` }}
          >
            {!relation && <span className="lp-dot" />}
            <span className="lp-node-label">{nodeLabel(id)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Diagram() {
  return (
    <figure className="lp-diagram" aria-label="Records connected">
      {GROUPS.map(({ title, runs }) => (
        <div key={title} className="lp-diagram-group">
          <h3 className="lp-eyebrow lp-eyebrow--teal">{title}</h3>
          <div className="lp-runs">
            {runs.map((run) => (
              <div key={run.id} className="lp-run">
                <RunDrawing run={run} />
                <ul className="lp-named-paths" role="list">
                  {namedPaths(run).map(({ sources, targets }) => (
                    <li key={sources.join(', ')}>
                      <span className="lp-path-source">
                        {sources.join(', ')}
                        <span className="lp-sr-only">:</span>
                      </span>
                      <ul className="lp-path-targets" role="list">
                        {targets.map(([label, relation]) => (
                          <li key={`${relation ?? ''}:${label}`}>
                            {relation && (
                              <>
                                <strong>{relation}</strong>{' '}
                              </>
                            )}
                            {label}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </figure>
  );
}
