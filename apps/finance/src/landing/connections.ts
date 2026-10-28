/**
 * The money / people and organizations / policy diagram. Each line leaves a
 * record's row end, runs to the gutter, bends once and stops at the dot of a
 * record in the next pane. No labels: the lists name every record. The set is
 * the approved drawing's (Product Landing, Alethical B2B Design project): 24
 * lines, only between adjacent panes.
 */

export type RecordId = `${'m' | 'p' | 'q'}${number}`;

export const PANES = [
  {
    id: 'm',
    title: 'MONEY',
    records: [
      'Contributions, with the giver named as filed',
      'Campaign spending and who was paid',
      'Outside spending, for or against a candidate, by race',
      'Campaign committees, party units, political committees and funds',
      'Filed reports with their official totals',
      'Lobbying spending, by organization and year',
      'Media buys: TV ad orders, invoices and disclosure forms from station files',
    ],
  },
  {
    id: 'p',
    title: 'PEOPLE AND ORGANIZATIONS',
    records: [
      'Candidates, from Minnesota Secretary of State filings',
      'Legislators, current and former',
      'Lobbyists and the organizations they are registered for',
      'Organizations confirmed as 1 record: lobbying principals, vendors, employers, media agencies',
      'Printed names not yet confirmed, kept apart',
    ],
  },
  {
    id: 'q',
    title: 'POLICY',
    records: [
      'Bills, with every version and action',
      'Authors and co-authors',
      'Roll-call votes, by legislator',
      'Committee assignments',
    ],
  },
] as const;

const FROM: ReadonlyArray<readonly [RecordId, readonly RecordId[]]> = [
  ['m0', ['p0', 'p1', 'p2', 'p3', 'p4']],
  ['m1', ['p0', 'p1', 'p3', 'p4']],
  ['m2', ['p0', 'p1']],
  ['m3', ['p0', 'p1']],
  ['m4', ['p0', 'p1']],
  ['m5', ['p3']],
  ['m6', ['p0', 'p1', 'p3', 'p4']],
  ['p1', ['q0', 'q1', 'q2', 'q3']],
];

export const CONNECTIONS: ReadonlyArray<readonly [RecordId, RecordId]> = FROM.flatMap(
  ([from, targets]) => targets.map((to) => [from, to] as const),
);

export interface Box {
  left: number;
  right: number;
  top: number;
  height: number;
}

export interface Measured {
  frame: Box;
  /** The end of a record's text. */
  text: (id: RecordId) => Box | null;
  dot: (id: RecordId) => Box | null;
  pane: (paneId: string) => Box | null;
}

/** The SVG path of every line whose ends are both on screen, side by side. */
export function linePaths(measured: Measured): string[] {
  const { frame } = measured;
  return CONNECTIONS.flatMap(([from, to]) => {
    const text = measured.text(from);
    const start = measured.dot(from);
    const end = measured.dot(to);
    const pane = measured.pane(from[0]);
    // Stacked panes (phone) put the target below, not beside: no line.
    if (!text || !start || !end || !pane || end.left < pane.right) return [];
    const x1 = text.right - frame.left + 8;
    const gutter = pane.right - frame.left + 6;
    const x2 = end.left - frame.left - 5;
    const y1 = start.top + start.height / 2 - frame.top;
    const y2 = end.top + end.height / 2 - frame.top;
    const k = (x2 - gutter) / 2;
    return [`M${x1} ${y1} H${gutter} C${gutter + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`];
  });
}
