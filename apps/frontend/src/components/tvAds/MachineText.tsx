import React, { Fragment, useMemo } from 'react';
import { highlight } from './Landing';
import { BLANK, layoutMachineText } from './machineTextLayout';

/** Source words with fill-in blanks drawn as a line and the search term marked. */
function Words({ text, query }: { text: string; query: string }) {
  const parts = text.split(BLANK);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="tv-mt-blank" role="img" aria-label="Blank line" />}
          {highlight(part, query)}
        </Fragment>
      ))}
    </>
  );
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
                <Words text={piece.text} query={query} />
              </p>
            );
          case 'paragraph':
            return (
              <p key={index} className="tv-mt-p">
                <Words text={piece.text} query={query} />
              </p>
            );
          case 'choice':
            return (
              <div key={index} className="tv-mt-choice">
                <span className="tv-mt-mark">{piece.marker}</span>
                <span>
                  <Words text={piece.text} query={query} />
                </span>
              </div>
            );
          case 'fields':
            return (
              <div key={index} className="tv-mt-pairs">
                {piece.pairs.map(([label, value], row) => (
                  <Fragment key={row}>
                    <span>
                      <Words text={label} query={query} />
                    </span>
                    <span>
                      <Words text={value} query={query} />
                    </span>
                  </Fragment>
                ))}
              </div>
            );
          case 'line':
            return (
              <p key={index} className="tv-mt-line">
                {piece.runs.map((run, cell) => (
                  <span key={cell}>
                    <Words text={run} query={query} />
                  </span>
                ))}
              </p>
            );
          case 'grid': {
            const pairs = piece.columns.length <= 2;
            return (
              <div key={index} className="tv-mt-scroll">
                <div
                  className={`tv-mt-grid${pairs ? ' tv-mt-wrap' : ''}`}
                  style={{
                    gridTemplateColumns: pairs
                      ? 'max-content minmax(0,1fr)'
                      : `repeat(${piece.columns.length}, max-content)`,
                  }}
                >
                  {piece.rows.map((row, rowIndex) =>
                    row === 'gap' ? (
                      <span key={rowIndex} className="tv-mt-gaprow" aria-hidden="true" />
                    ) : (
                      row.map((cell, column) => (
                        <span
                          key={`${rowIndex}-${column}`}
                          className={piece.columns[column].right ? 'tv-mt-r' : undefined}
                        >
                          {cell === null ? null : <Words text={cell} query={query} />}
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
