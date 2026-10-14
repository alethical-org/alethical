import { describe, expect, it } from 'vitest';
import { layoutMachineText, type Piece } from '../machineTextLayout';
import { orderStationCategories } from '../api';

// Invented text shaped like the station files' extracted layout (pdftotext -layout).
const ORDER = `Print Date 01/02/26 10:00:00          Page 1 of 2

                                                    ORDER

Orders              Order / Rev:              111222
                    Product Desc:             Sample Lakes Fund                         SAMPLE-TV, LLC

                    Estimate:                 4471                       Primary AE:          Pat Example
                    Flight Dates:             01/05/26 - 01/11/26        Sales Office:        H-XYZ
                    Order Type:               GENERAL

Bill Plan                                                Totals
Start Date      End Date            # Spots      Gross Amount     Month          # Spots      Gross Amount
01/05/26        01/31/26                 48        $9,650.00     Jan 2026            48         $9,650.00
02/01/26        02/01/26                  9          $950.00     Feb 2026             9           $950.00
                                                                 Totals              57        $10,600.00
`;

const FORM = `ISSUE ADVERTISEMENT
                              AGREEMENT FORM
   I, ____________________________,
   Check one:
      ✔      Ad refers to an election to federal office, a national legislative
            issue of public importance, or a political issue that is the
            subject of discussion at the national level.
             Ad does NOT refer to any political matter of national importance (e.g., relates
            only to a state or local issue).

                    ALL QUESTIONS MUST BE COMPLETED
Agency name: Sample Media LLC
Address: PO Box 100
Contact: ops@example.invalid                Phone number:                     Email: ops@example.invalid

Name of advertiser (list the full legal name as disclosed to the Federal Election Commission [for federal
committees] with no acronyms):
Date of election:
Credit                                                                 -$500.00
`;

function words(pieces: Piece[]): string[] {
  const out: string[] = [];
  const add = (value: string | null) => value && out.push(...value.split(/\s+/).filter(Boolean));
  for (const piece of pieces) {
    if (piece.kind === 'centred' || piece.kind === 'paragraph') add(piece.text);
    if (piece.kind === 'choice') add(`${piece.marker} ${piece.text}`);
    if (piece.kind === 'fields') piece.pairs.forEach(([l, v]) => (add(l), add(v)));
    if (piece.kind === 'line') piece.runs.forEach(add);
    if (piece.kind === 'grid')
      piece.rows.forEach((row) => row !== 'gap' && row.forEach((cell) => add(cell)));
  }
  return out;
}
const sourceWords = (text: string) => text.split(/\s+/).filter(Boolean);
const grids = (pieces: Piece[]) =>
  pieces.filter((p): p is Extract<Piece, { kind: 'grid' }> => p.kind === 'grid');

describe('layoutMachineText', () => {
  it('never changes, drops, adds or reorders a word', () => {
    for (const text of [ORDER, FORM])
      expect(words(layoutMachineText(text))).toEqual(sourceWords(text));
  });

  it('puts every value of a label block at one column, figures included', () => {
    const [orders] = grids(layoutMachineText(ORDER));
    const columnOf = (value: string) =>
      orders.rows.map((row) => (row === 'gap' ? -1 : row.indexOf(value))).find((i) => i >= 0);
    expect(columnOf('111222')).toBe(columnOf('Sample Lakes Fund'));
    expect(columnOf('4471')).toBe(columnOf('GENERAL'));
    expect(columnOf('Pat Example')).toBe(columnOf('H-XYZ'));
    expect(columnOf('Primary AE:')).toBe(columnOf('Sales Office:'));
    // The blank source line inside the section stays as a gap row.
    expect(orders.rows).toContain('gap');
  });

  it('right-aligns figure columns under their headers', () => {
    const plan = grids(layoutMachineText(ORDER))[1];
    const row = plan.rows.find((r) => r !== 'gap' && r.includes('$9,650.00')) as string[];
    const total = plan.rows.find((r) => r !== 'gap' && r.includes('$10,600.00')) as string[];
    expect(plan.columns[row.lastIndexOf('$9,650.00')].right).toBe(true);
    expect(total.lastIndexOf('$10,600.00')).toBe(row.lastIndexOf('$9,650.00'));
    expect(total.indexOf('57')).toBe(row.lastIndexOf('48'));
  });

  it('centres the title the source centres', () => {
    expect(layoutMachineText(ORDER)).toContainEqual({ kind: 'centred', text: 'ORDER' });
    expect(layoutMachineText(FORM)).toContainEqual({ kind: 'centred', text: 'AGREEMENT FORM' });
  });

  it('lays out forms: choices, rejoined sentences, stacked fields, kept labels', () => {
    const pieces = layoutMachineText(FORM);
    const choices = pieces.filter((p) => p.kind === 'choice');
    expect(choices).toEqual([
      {
        kind: 'choice',
        marker: '✔',
        text: 'Ad refers to an election to federal office, a national legislative issue of public importance, or a political issue that is the subject of discussion at the national level.',
      },
      // Its mark was not read: the marker column stays empty, nothing is drawn.
      {
        kind: 'choice',
        marker: '',
        text: 'Ad does NOT refer to any political matter of national importance (e.g., relates only to a state or local issue).',
      },
    ]);
    expect(pieces).toContainEqual({
      kind: 'fields',
      pairs: [
        ['Agency name:', 'Sample Media LLC'],
        ['Address:', 'PO Box 100'],
        ['Contact:', 'ops@example.invalid'],
        ['Phone number:', ''],
        ['Email:', 'ops@example.invalid'],
      ],
    });
    expect(pieces).toContainEqual({
      kind: 'paragraph',
      text: 'Name of advertiser (list the full legal name as disclosed to the Federal Election Commission [for federal committees] with no acronyms):',
    });
    // A capitalised label line after a finished sentence stays its own line.
    expect(pieces).toContainEqual({ kind: 'paragraph', text: 'Date of election:' });
  });

  it('keeps signs as printed', () => {
    expect(words(layoutMachineText(FORM))).toContain('-$500.00');
  });
});

describe('orderStationCategories', () => {
  it('orders by level of government, then other names A to Z ignoring case', () => {
    expect(
      orderStationCategories(['Zeta', 'Local', 'apple', 'Federal', 'Ballot', 'State', 'Terms']),
    ).toEqual(['Federal', 'State', 'Local', 'Terms', 'apple', 'Ballot', 'Zeta']);
  });
});
