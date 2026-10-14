import React, { Fragment, useMemo } from 'react';
import { BLANK, layoutMachineText } from './machineTextLayout';

type Range = [number, number];

/** Where the search term occurs in text, ignoring case. */
function rangesIn(text: string, query: string): Range[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const lower = text.toLowerCase();
  const found: Range[] = [];
  for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length))
    found.push([at, at + term.length]);
  return found;
}

/**
 * The search term's ranges inside each part, when the parts were one printed run
 * ("Label: value") split into 2 cells: a match spanning the label and its value marks
 * both halves, as it would on the printed line.
 */
function rangesAcross(parts: string[], query: string): Range[][] {
  const joined = parts.join(' ');
  const matches = rangesIn(joined, query);
  let offset = 0;
  return parts.map((part) => {
    const start = offset;
    offset += part.length + 1;
    return matches
      .map(([a, b]): Range => [
        Math.max(a, start) - start,
        Math.min(b, start + part.length) - start,
      ])
      .filter(([a, b]) => b > a);
  });
}

/** Source words with fill-in blanks drawn as a line and the search term marked. */
function Words({ text, marks }: { text: string; marks: Range[] }) {
  const nodes: React.ReactNode[] = [];
  const blank = (segment: string, key: string) =>
    segment
      .split(BLANK)
      .flatMap((part, index) => [
        ...(index > 0
          ? [
              <span
                key={`${key}-b${index}`}
                className="tv-mt-blank"
                role="img"
                aria-label="Blank line"
              />,
            ]
          : []),
        part,
      ]);
  let at = 0;
  marks.forEach(([a, b], index) => {
    if (a > at) nodes.push(...blank(text.slice(at, a), `t${index}`));
    nodes.push(<mark key={`m${index}`}>{blank(text.slice(a, b), `m${index}`)}</mark>);
    at = b;
  });
  if (at < text.length) nodes.push(...blank(text.slice(at), 'end'));
  return <>{nodes}</>;
}

/** Cells of one grid row, with each label and the value printed after it marked together. */
function rowMarks(row: Array<string | null>, query: string): Range[][] {
  const marks: Range[][] = row.map(() => []);
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    if (cell === null) continue;
    const next = row.slice(i + 1).findIndex((value) => value !== null) + i + 1;
    if (cell.endsWith(':') && next > i && row[next] !== null) {
      const [left, right] = rangesAcross([cell, row[next] as string], query);
      marks[i] = left;
      marks[next] = right;
      i = next;
    } else marks[i] = rangesIn(cell, query);
  }
  return marks;
}

/** Machine-read text on the grids its printed positions support (layoutMachineText). */
export function MachineText({ text, query }: { text: string; query: string }) {
  const pieces = useMemo(() => layoutMachineText(text), [text]);
  return (
    <div className="tv-text">
      {pieces.map((piece, index) => {
        switch (piece.kind) {
          case 'gap':
            return <div key={index} className="tv-mt-gap" aria-hidden="true" />;
          case 'centred':
            return (
              <p key={index} className="tv-mt-centred">
                <Words text={piece.text} marks={rangesIn(piece.text, query)} />
              </p>
            );
          case 'paragraph':
            return (
              <p key={index} className="tv-mt-p">
                <Words text={piece.text} marks={rangesIn(piece.text, query)} />
              </p>
            );
          case 'choice':
            return (
              <div key={index} className="tv-mt-choice">
                <span className="tv-mt-mark">{piece.marker}</span>
                <span>
                  <Words text={piece.text} marks={rangesIn(piece.text, query)} />
                </span>
              </div>
            );
          case 'fields':
            return (
              <div key={index} className="tv-mt-pairs">
                {piece.pairs.map(([label, value], row) => {
                  const [labelMarks, valueMarks] = rangesAcross([label, value], query);
                  return (
                    <Fragment key={row}>
                      <span>
                        <Words text={label} marks={labelMarks} />
                      </span>
                      <span>
                        <Words text={value} marks={valueMarks} />
                      </span>
                    </Fragment>
                  );
                })}
              </div>
            );
          case 'line':
            return (
              <p key={index} className="tv-mt-line">
                {piece.runs.map((run, cell) => (
                  <span key={cell}>
                    <Words text={run} marks={rangesIn(run, query)} />
                  </span>
                ))}
              </p>
            );
          case 'grid': {
            const pairs = piece.columns.length === 2;
            const single = piece.columns.length === 1;
            return (
              <div key={index} className="tv-mt-scroll">
                <div
                  className={`tv-mt-grid${pairs || single ? ' tv-mt-wrap' : ''}`}
                  style={{
                    gridTemplateColumns: single
                      ? 'minmax(0,1fr)'
                      : pairs
                        ? 'max-content minmax(0,1fr)'
                        : `repeat(${piece.columns.length}, max-content)`,
                  }}
                >
                  {piece.rows.map((row, rowIndex) =>
                    row === 'gap' ? (
                      <span key={rowIndex} className="tv-mt-gaprow" aria-hidden="true" />
                    ) : (
                      rowMarks(row, query)
                        .map((marks, column) => ({ cell: row[column], marks, column }))
                        .map(({ cell, marks, column }) => (
                          <span
                            key={`${rowIndex}-${column}`}
                            className={piece.columns[column].right ? 'tv-mt-r' : undefined}
                          >
                            {cell === null ? null : <Words text={cell} marks={marks} />}
                          </span>
                        ))
                    ),
                  )}
                </div>
              </div>
            );
          }
        }
      })}
    </div>
  );
}
