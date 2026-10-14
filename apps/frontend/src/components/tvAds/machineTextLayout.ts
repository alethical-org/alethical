/**
 * Lays out machine-read station file text (pdftotext "layout" output) on grids.
 *
 * The extraction keeps each run of words at roughly its printed x position as a
 * character column, with 2 or more spaces between runs. This module reads those
 * positions and nothing else: words, their order, case and signs are never changed,
 * no relationship is inferred from wording, and text that has no repeated structure
 * stays a plain line in source order.
 */

export interface Run {
  text: string;
  start: number;
  end: number;
  /** A figure: aligned on its last character, like the source prints it. */
  numeric: boolean;
}

export type Piece =
  | { kind: 'gap' }
  /** A single source line the station centred, such as a form title. */
  | { kind: 'centred'; text: string }
  /** Source lines that continue one sentence, joined with single spaces. */
  | { kind: 'paragraph'; text: string }
  /** A choice or list item; marker is '' when the extraction read no mark. */
  | { kind: 'choice'; marker: string; text: string }
  /** Label and value pairs, one per row, in source order. */
  | { kind: 'fields'; pairs: Array<[string, string]> }
  /** Runs on one line with no column structure to share. */
  | { kind: 'line'; runs: string[] }
  /** Lines whose runs share printed columns. Cells are null where a row has no run. */
  | { kind: 'grid'; columns: Array<{ right: boolean }>; rows: Array<Array<string | null> | 'gap'> };

const RUN = /\S+(?: \S+)*/g;
// "Label: value" inside one run: a short label that starts like a heading word.
const COLON_LABEL = /^([A-Z#(][^:]{0,38}?:) (\S.*)$/;
const NUMERIC = /^[-−+]?\(?[$]?\d[\d,]*(?:\.\d+)?\)?%?$|^:\d\d$/;
const MARKER = /^(?:[✔✓✗✘☐☑☒□■●•▪◦*-]|\(\d{1,2}\)|\d{1,2}[.)]|[a-z][.)])$/;
const MARKER_LEAD = /^((?:[✔✓✗✘☐☑☒□■●•▪◦])|\(\d{1,2}\)|[a-z]\))\s+(\S.*)$/;
const TERMINAL = /[.!?:;]["”’)]*$/;
const TOLERANCE = 2;

function words(value: string) {
  return value.trim().split(/\s+/).length;
}

export function runsOf(line: string): Run[] {
  const runs: Run[] = [];
  for (const match of line.matchAll(RUN)) {
    const start = match.index ?? 0;
    const text = match[0];
    const label = COLON_LABEL.exec(text);
    if (label && words(label[1]) <= 5) {
      runs.push({ text: label[1], start, end: start + label[1].length, numeric: false });
      const valueStart = start + label[1].length + 1;
      runs.push({
        text: label[2],
        start: valueStart,
        end: valueStart + label[2].length,
        numeric: NUMERIC.test(label[2]),
      });
    } else runs.push({ text, start, end: start + text.length, numeric: NUMERIC.test(text) });
  }
  return runs;
}

const isLabel = (run: Run) => run.text.endsWith(':');

/** A line made only of "Label: value" pairs, as on a filled-in form. */
function fieldPairs(runs: Run[]): Array<[string, string]> | null {
  if (!isLabel(runs[0])) return null;
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < runs.length; i++) {
    if (!isLabel(runs[i])) return null;
    const next = runs[i + 1];
    if (next && !isLabel(next)) {
      pairs.push([runs[i].text, next.text]);
      i++;
    } else pairs.push([runs[i].text, '']);
  }
  return pairs;
}

/** Group a block's lines into printed columns by each run's anchor position. */
function grid(lines: Array<Run[] | 'gap'>): Piece {
  const all = lines.flatMap((line) => (line === 'gap' ? [] : line));
  // A figure is right-aligned only when other figures end exactly where it ends more
  // often than other runs start exactly where it starts; label/value blocks keep one
  // value x. The source right-aligns figures on a shared last character.
  const right = new Map<Run, boolean>();
  for (const run of all) {
    if (!run.numeric) continue;
    const starts = all.filter((o) => o !== run && o.start === run.start).length;
    const ends = all.filter((o) => o !== run && o.numeric && o.end === run.end).length;
    right.set(run, ends >= starts && ends > 0);
  }
  const anchorOf = (run: Run) => (right.get(run) ? run.end : run.start);
  const anchors = all.map((run) => ({ at: anchorOf(run), right: !!right.get(run) }));
  anchors.sort((a, b) => a.at - b.at);
  const clusters: Array<{ low: number; high: number; right: number; total: number }> = [];
  for (const anchor of anchors) {
    const last = clusters.at(-1);
    if (last && anchor.at - last.high <= TOLERANCE) {
      last.high = anchor.at;
      last.total += 1;
      if (anchor.right) last.right += 1;
    } else
      clusters.push({ low: anchor.at, high: anchor.at, total: 1, right: anchor.right ? 1 : 0 });
  }
  const columnOf = (run: Run) => {
    const at = anchorOf(run);
    return clusters.findIndex((c) => at >= c.low && at <= c.high);
  };
  const rows: Array<Array<string | null> | 'gap'> = [];
  for (const line of lines) {
    if (line === 'gap') {
      rows.push('gap');
      continue;
    }
    const row: Array<string | null> = clusters.map(() => null);
    let previous = -1;
    let ordered = true;
    for (const run of line) {
      const column = columnOf(run);
      if (column <= previous) ordered = false;
      previous = column;
      if (column >= 0) row[column] = run.text;
    }
    // A row whose runs cannot keep their order in shared columns keeps its source
    // order in the first cell rather than being rearranged.
    rows.push(
      ordered
        ? row
        : [line.map((run) => run.text).join('   '), ...clusters.slice(1).map(() => null)],
    );
  }
  return {
    kind: 'grid',
    columns: clusters.map((c) => ({ right: c.right * 2 > c.total })),
    rows,
  };
}

export function layoutMachineText(text: string): Piece[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));
  const pieces: Piece[] = [];
  const width = Math.max(1, ...lines.map((line) => line.length));
  // Blocks: consecutive non-blank lines; one blank line between 2 multi-run lines
  // stays inside the block as a gap row.
  const blocks: Array<Array<Run[] | 'gap'>> = [];
  let current: Array<Run[] | 'gap'> = [];
  for (let i = 0; i < lines.length; i++) {
    const runs = runsOf(lines[i]);
    if (runs.length) {
      current.push(runs);
      continue;
    }
    const before = current.at(-1);
    const after = lines[i + 1] ? runsOf(lines[i + 1]) : [];
    // A line starting at the left margin begins a new section, so the gap ends the block.
    if (before && before !== 'gap' && before.length > 1 && after.length > 1 && after[0].start > 0)
      current.push('gap');
    else if (current.length) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);

  blocks.forEach((block, index) => {
    if (index) pieces.push({ kind: 'gap' });
    const multi = block.filter((line) => line !== 'gap' && line.length > 1);
    // Columns shared by most lines make a grid, unless every multi-run line is a run of
    // form fields, which stack one pair per row; mostly single-run blocks read as prose.
    const filled = block.filter((line) => line !== 'gap').length;
    const tableLike =
      multi.length >= 2 &&
      multi.length * 2 >= filled &&
      !multi.every((line) => fieldPairs(line as Run[]));
    if (tableLike) {
      pieces.push(grid(block));
      return;
    }
    let open: (Piece & { kind: 'paragraph' | 'choice' }) | null = null;
    let openTextColumn = -1;
    for (const line of block) {
      if (line === 'gap') {
        open = null;
        pieces.push({ kind: 'gap' });
        continue;
      }
      const first = line[0];
      const whole = line.map((run) => run.text).join(' ');
      // Continue a sentence: no terminal punctuation, and the next line starts in
      // lower case or at the text column of the open choice.
      if (
        open &&
        line.length === 1 &&
        !TERMINAL.test(open.text) &&
        (/^[a-z]/.test(first.text) ||
          (open.kind === 'choice' && Math.abs(first.start - openTextColumn) <= 1))
      ) {
        open.text = `${open.text} ${first.text}`;
        continue;
      }
      const last = pieces.at(-1);
      if (last?.kind === 'fields' && line.length === 1 && /^[a-z]/.test(first.text)) {
        const pair = last.pairs[last.pairs.length - 1];
        if (pair[1] && !TERMINAL.test(pair[1])) {
          pair[1] = `${pair[1]} ${first.text}`;
          continue;
        }
      }
      open = null;
      const pairs = line.length > 1 ? fieldPairs(line) : null;
      if (pairs) {
        const last = pieces.at(-1);
        if (last?.kind === 'fields') last.pairs.push(...pairs);
        else pieces.push({ kind: 'fields', pairs });
        continue;
      }
      if (line.length === 2 && MARKER.test(first.text)) {
        open = { kind: 'choice', marker: first.text, text: line[1].text };
        openTextColumn = line[1].start;
        pieces.push(open);
        continue;
      }
      if (line.length === 1) {
        const lead = MARKER_LEAD.exec(first.text);
        const previous = pieces.at(-1);
        if (lead) {
          open = { kind: 'choice', marker: lead[1], text: lead[2] };
          openTextColumn = first.start + lead[1].length + 1;
          pieces.push(open);
          continue;
        }
        // A line starting at an earlier choice's text column is a choice whose mark
        // was not read: it keeps an empty marker column.
        if (previous?.kind === 'choice' && Math.abs(first.start - openTextColumn) <= 1) {
          open = { kind: 'choice', marker: '', text: first.text };
          openTextColumn = first.start;
          pieces.push(open);
          continue;
        }
        // Centred only when the line sits indented in the middle of the printed width.
        const centre = (first.start + first.end) / 2;
        if (
          first.start >= 16 &&
          first.text.length <= 60 &&
          Math.abs(centre - width / 2) <= width * 0.15
        ) {
          pieces.push({ kind: 'centred', text: first.text });
          continue;
        }
        open = { kind: 'paragraph', text: first.text };
        openTextColumn = first.start;
        pieces.push(open);
        continue;
      }
      pieces.push({ kind: 'line', runs: line.map((run) => run.text) });
    }
  });
  return pieces;
}

/** Fill-in blanks: 4 or more underscores. */
export const BLANK = /_{4,}/g;
