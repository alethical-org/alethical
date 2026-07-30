// Bill Text tab parsing, the structured path — reading the section body from the
// blocks ingestion captured (`body_blocks`, #741) instead of inferring it from the
// flattened text.
//
// The five properties billText.test.ts pins must hold here too, because this is
// the path that now renders for every re-read section. On top of them, one more:
// the structured body must render every character the flat body renders, so
// reading blocks can never drop wording from the page.
//
// The fixture (fixtures/bill-text-body-blocks.json) is real sections from real
// bills — provenance in fixtures/README.md.

import { describe, expect, it } from 'vitest';

import {
  appropriationColumnLabels,
  asHeadingCaption,
  blockTexts,
  changeKindsPresent,
  headingLabel,
  parseChangeRuns,
  parseSectionBody,
  parseStructuredBody,
  plainSectionText,
  sectionIndexLabel,
  SectionBody,
  splitSectionLabel,
  SourceBlock,
  tidyTable,
} from '../billText';
import sections from './fixtures/bill-text-body-blocks.json';

type Section = (typeof sections)[number];

const MARKER_WORDS = /(?:deleted|new) text (?:begin|end)/i;

function blocksOf(section: Section): SourceBlock[] {
  return section.bodyBlocks as SourceBlock[];
}

/** Every string in a body block, table cells included — a table block carries no
 *  text of its own, so anything that only reads `block.text` misses a whole
 *  appropriation section. */
function bodyBlockTexts(body: SectionBody): string[] {
  return body.blocks.flatMap((block) =>
    block.kind === 'table' && block.table
      ? [
          ...(block.table.columnLabels ?? []),
          ...block.table.rows.flatMap((row) => row.map((cell) => cell.text)),
        ]
      : [block.text],
  );
}

/** The strings FullTextTab.tsx paints for one section, on the structured path. */
function renderedStrings(section: Section): string[] {
  const { number, title } = splitSectionLabel(section.heading);
  const body = structuredBody(section);
  const heading = title ?? asHeadingCaption(body.caption);
  const runs = [
    ...(body.leadIn ? parseChangeRuns(body.leadIn) : []),
    ...bodyBlockTexts(body).flatMap((text) => parseChangeRuns(text)),
  ];
  return [
    number,
    heading,
    sectionIndexLabel(section.heading, section.text, blocksOf(section)),
    ...runs.map((run) => run.text),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/** Everything a body renders, with all whitespace removed. */
function squashed(body: SectionBody): string {
  return plainSectionText(
    [body.leadIn ?? '', body.caption ?? '', ...bodyBlockTexts(body)].join(' '),
  ).replace(/\s+/g, '');
}

/**
 * One section's body as the tab reads it, with its article's fiscal years carried
 * in — the same thing FullTextTab does, because an appropriation article states
 * those years in its first section and the figures they head are in later ones.
 */
function structuredBody(section: Section): SectionBody {
  const { title } = splitSectionLabel(section.heading);
  const article = section.articleHeading ?? '';
  const years =
    sections
      .filter((s) => (s.articleHeading ?? '') === article)
      .map((s) => appropriationColumnLabels(blocksOf(s)))
      .find(Boolean) ?? null;
  return parseStructuredBody(blocksOf(section), {
    hasTitle: !!title,
    columnLabels: years,
  });
}

function withId(section: Section): string {
  return `${section.billId}/${section.sectionId}`;
}

it('the fixture is real sections carrying real captured structure', () => {
  expect(sections.length).toBeGreaterThan(3);
  expect(new Set(sections.map((s) => s.billId)).size).toBeGreaterThan(2);
  // Every claim below rests on the three things flattening destroyed, so all
  // three must be present somewhere in the fixture.
  expect(sections.some((s) => blocksOf(s).some((b) => b.kind === 'heading' && b.number))).toBe(
    true,
  );
  expect(sections.some((s) => blockTexts(blocksOf(s)).some((t) => /new text begin/.test(t)))).toBe(
    true,
  );
  expect(sections.some((s) => blocksOf(s).some((b) => b.kind === 'table'))).toBe(true);
});

describe('property 1: no marker word ever reaches the screen', () => {
  it('holds for every rendered string on the structured path', () => {
    const leaked: string[] = [];
    for (const section of sections) {
      for (const value of renderedStrings(section)) {
        if (MARKER_WORDS.test(value)) leaked.push(`${withId(section)}: ${value.slice(0, 120)}`);
      }
    }
    expect(leaked).toEqual([]);
  });
});

describe('property 2: no index row is blank where the source names a caption', () => {
  it('holds for every fixture section', () => {
    for (const section of sections) {
      const { title } = splitSectionLabel(section.heading);
      const body = structuredBody(section);
      const hasCaption = !!(
        title ??
        body.caption ??
        body.blocks.find((b) => b.kind === 'subheading')
      );
      if (!hasCaption) continue;
      expect(
        sectionIndexLabel(section.heading, section.text, blocksOf(section)),
        withId(section),
      ).not.toBe('');
    }
  });
});

describe('property 3: a caption used as a heading loses its period and keeps its case', () => {
  it('holds for every heading the structured path produces', () => {
    for (const section of sections) {
      const { title } = splitSectionLabel(section.heading);
      const body = structuredBody(section);
      for (const heading of [
        asHeadingCaption(body.caption),
        sectionIndexLabel(section.heading, section.text, blocksOf(section)),
      ]) {
        if (!heading) continue;
        if (/(?:\b[A-Za-z]\.){2,}$/.test(heading)) continue;
        expect(heading, withId(section)).not.toMatch(/\.$/);
      }
    }
  });
});

describe('property 6: every block the source captured reaches the screen', () => {
  // Order-independent by design. Laying a table out reorders its cells — spacer
  // cells go, a lone "$" folds into the figure beside it — so comparing character
  // by character against the flat text reports differences that are not losses.
  // What must hold is that no unit of the source goes missing.
  it('holds for every paragraph, heading and cell of every fixture section', () => {
    for (const section of sections) {
      const body = structuredBody(section);
      const shown = [
        asHeadingCaption(body.caption) ?? '',
        body.leadIn ?? '',
        ...bodyBlockTexts(body),
      ]
        .map((text) => plainSectionText(text))
        .join(' ');

      for (const block of blocksOf(section)) {
        const units =
          block.kind === 'table'
            ? block.rows.flat().map((cell) => cell.text)
            : [headingLabel(block as { number?: string; text?: string })];
        for (const unit of units) {
          // A caption promoted to the card title loses one trailing period by
          // design (property 3); a lone "$" is folded into its figure.
          const want = plainSectionText(unit).trim().replace(/\.$/, '');
          if (!want || want === '$') continue;
          expect(shown, `${withId(section)} dropped "${want.slice(0, 60)}"`).toContain(want);
        }
      }
    }
  });

  it('still renders what the flat path renders, on a section with no table', () => {
    const plainSection = sections.find((s) => !blocksOf(s).some((b) => b.kind === 'table'))!;
    const { title } = splitSectionLabel(plainSection.heading);
    const flat = squashed(parseSectionBody(plainSection.text, { hasTitle: !!title }));
    const structured = squashed(structuredBody(plainSection));
    let cursor = 0;
    for (const character of flat) {
      cursor = structured.indexOf(character, cursor) + 1;
      if (cursor === 0) break;
    }
    expect(cursor, `${withId(plainSection)} drops wording the flat text renders`).not.toBe(0);
  });
});

describe('the subdivision number reaches the page', () => {
  it('appears wherever the source published one, and never did before', () => {
    const numbered = sections.filter((s) =>
      blocksOf(s).some((b) => b.kind === 'heading' && b.number),
    );
    expect(numbered.length).toBeGreaterThan(0);

    for (const section of numbered) {
      const { title } = splitSectionLabel(section.heading);
      const structured = structuredBody(section);
      const shown = [structured.caption ?? '', ...bodyBlockTexts(structured)].join(' ');
      expect(plainSectionText(shown), withId(section)).toMatch(/\b(?:Subd\.|Subdivision)\s/);

      // The flat text cannot show it: the flattening strips the h2 that holds it.
      expect(section.text, withId(section)).not.toMatch(/\b(?:Subd\.|Subdivision)\s+\d/);
    }
  });

  it('joins the number to its title the way the Legislature writes them', () => {
    expect(headingLabel({ number: 'Subd. 3.', text: 'Health plan.' })).toBe(
      'Subd. 3. Health plan.',
    );
    expect(headingLabel({ number: '', text: 'Definitions.' })).toBe('Definitions.');
    expect(headingLabel({ number: 'Subd. 2.', text: '' })).toBe('Subd. 2.');
    expect(headingLabel({})).toBe('');
  });
});

describe('the added-text marks reach the page', () => {
  it('the legend can name the underline on a section with additions', () => {
    const added = sections.filter((s) =>
      blockTexts(blocksOf(s)).some((t) => /new text begin/.test(t)),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const section of added) {
      expect(changeKindsPresent(blockTexts(blocksOf(section))).added, withId(section)).toBe(true);
      // The flat text is why the legend never promised an underline before.
      expect(changeKindsPresent([section.text]).added, withId(section)).toBe(false);
    }
  });

  it('renders an added run as an added run, not as plain law', () => {
    const runs = parseChangeRuns(
      'clause deleted text begin (5) deleted text end new text begin (4) new text end , applies.',
    );
    expect(runs.filter((r) => r.kind === 'added').map((r) => r.text)).toEqual(['(4)']);
    expect(runs.filter((r) => r.kind === 'removed').map((r) => r.text)).toEqual(['(5)']);
    expect(runs.map((r) => r.text).join('')).not.toMatch(MARKER_WORDS);
  });
});

describe('a captured table lays out as a table (#752)', () => {
  const tabled = sections.filter((s) => blocksOf(s).some((b) => b.kind === 'table'));

  it('loses no cell it captured', () => {
    expect(tabled.length).toBeGreaterThan(0);
    for (const section of tabled) {
      const captured = blocksOf(section)
        .flatMap((b) => (b.kind === 'table' ? b.rows.flat() : []))
        .map((cell) => plainSectionText(cell.text).trim())
        // A lone "$" is folded into the figure beside it, so it is not a cell of
        // its own on the way out. The next assertion covers where it went.
        .filter((text) => text && text !== '$');
      const rendered = bodyBlockTexts(structuredBody(section))
        .map((text) => plainSectionText(text))
        .join(' ');
      for (const cell of captured) {
        expect(rendered, `${withId(section)} lost the cell "${cell}"`).toContain(cell);
      }
    }
  });

  it('joins each lone dollar sign to its figure', () => {
    // The defect this issue opened on: "$" on one line, "(822,000)" on the next.
    const rows = tidyTable(
      [
        [
          { text: 'General Fund' },
          { text: '$', align: 'center' },
          { text: '652,953,000', align: 'right' },
          { text: '$', align: 'center' },
          { text: '(145,196,000)', align: 'right' },
        ],
      ],
      null,
    );
    expect(rows?.rows).toEqual([
      [
        { text: 'General Fund', align: 'left' },
        { text: '$652,953,000', align: 'right' },
        { text: '$(145,196,000)', align: 'right' },
      ],
    ]);
  });

  it('joins a dollar sign to its figure without leaking the change marks', () => {
    const table = tidyTable(
      [
        [
          { text: 'new text begin Total Appropriation new text end', colspan: 3 },
          { text: 'new text begin $ new text end', align: 'center' },
          { text: 'new text begin 739,634,000 new text end', align: 'right' },
        ],
      ],
      null,
    );
    const figure = table!.rows[0][1].text;
    const painted = parseChangeRuns(figure);
    expect(painted.map((run) => run.text).join('')).toBe('$739,634,000');
    expect(painted.every((run) => run.kind === 'added')).toBe(true);
    // Two marker pairs end up back to back, which is fine — each closes on its
    // own end marker — as long as no marker word survives into the painted text.
    expect(painted.map((run) => run.text).join('')).not.toMatch(MARKER_WORDS);
  });

  it('drops the spacer columns so figures line up', () => {
    const table = tidyTable(
      [
        [{ text: 'Health Care Access Fund' }, { text: '' }, { text: '86,681,000', align: 'right' }],
        [{ text: 'General Fund' }, { text: '' }, { text: '652,953,000', align: 'right' }],
      ],
      null,
    );
    expect(table?.rows.map((row) => row.length)).toEqual([2, 2]);
  });

  it('puts the fiscal years above the figures they head', () => {
    const years = appropriationColumnLabels(
      blocksOf(sections.find((s) => s.sectionId === 'laws.7.1.0')!),
    );
    expect(years).toEqual(['2026', '2027']);

    // The years are published in the article's FIRST section; the figures are in
    // the ones after it, so they have to be carried across.
    const figures = sections.find((s) => s.sectionId === 'laws.7.2.0')!;
    expect(appropriationColumnLabels(blocksOf(figures))).toBeNull();

    const laidOut = structuredBody(figures)
      .blocks.filter((b) => b.kind === 'table')
      .map((b) => b.table!);
    expect(laidOut.length).toBeGreaterThan(0);
    for (const table of laidOut) {
      const width = table.rows[0].length;
      // Labelled only where the count matches — a mismatch would put a year over
      // a figure that is not from that year.
      if (table.columnLabels) expect(table.columnLabels.length).toBe(width - 1);
    }
    expect(laidOut.some((t) => t.columnLabels?.join() === '2026,2027')).toBe(true);
  });

  it('never invents a year, and never labels a table of the wrong width', () => {
    const twoFigures = tidyTable(
      [[{ text: 'General Fund' }, { text: '1' }, { text: '2' }]],
      ['2026', '2027'],
    );
    expect(twoFigures?.columnLabels).toEqual(['2026', '2027']);

    const oneFigure = tidyTable([[{ text: 'General Fund' }, { text: '1' }]], ['2026', '2027']);
    expect(oneFigure?.columnLabels).toBeNull();

    const noYears = tidyTable([[{ text: 'General Fund' }, { text: '1' }, { text: '2' }]], null);
    expect(noYears?.columnLabels).toBeNull();
  });

  it('falls back to paragraphs when it is not really a table', () => {
    // One column of prose is a paragraph, not a table.
    expect(tidyTable([[{ text: 'The commissioner shall report annually.' }]], null)).toBeNull();
    expect(tidyTable([[{ text: '' }, { text: '' }]], null)).toBeNull();

    const body = parseStructuredBody(
      [{ kind: 'table', rows: [[{ text: 'The commissioner shall report annually.' }]] }],
      { hasTitle: true },
    );
    expect(body.blocks.map((b) => b.kind)).toEqual(['para']);
    expect(body.blocks[0].text).toBe('The commissioner shall report annually.');
  });

  it('keeps a year row as a row when there are no figures for it to head', () => {
    // The article's opening section IS the header; lifting the years out of it
    // would leave a header with nothing under it and the years off the page.
    const opening = sections.find((s) => s.sectionId === 'laws.7.1.0')!;
    const table = structuredBody(opening).blocks.find((b) => b.kind === 'table')!.table!;
    const shown = table.rows.flat().map((cell) => plainSectionText(cell.text));
    expect(shown).toContain('2026');
    expect(shown).toContain('2027');
  });
});

describe('the flat path stays the fallback', () => {
  it('an index row falls back to inferring the caption when no blocks exist', () => {
    const text =
      'Minnesota Statutes 2024, section 62A.011, subdivision 3, is amended to read:\n\n' +
      'Health plan.\n\n' +
      '"Health plan" means a policy of accident and sickness insurance.';
    expect(sectionIndexLabel('Sec. 2.', text, null)).toBe('Health plan');
    expect(sectionIndexLabel('Sec. 2.', text, [])).toBe('Health plan');
  });

  it('a struck caption is not promoted to a title on either path', () => {
    const blocks: SourceBlock[] = [
      { kind: 'heading', number: '', text: 'deleted text begin Old name. deleted text end' },
      { kind: 'para', text: 'The commissioner shall publish the schedule.' },
    ];
    const body = parseStructuredBody(blocks, { hasTitle: false });
    expect(body.caption).toBeNull();
    // It stays in the body, where its strike-through renders.
    expect(body.blocks[0].kind).toBe('subheading');
    expect(body.blocks[0].text).toMatch(/deleted text begin/);
  });

  it('promotes the opening amendment clause to provenance, not to the title', () => {
    const blocks: SourceBlock[] = [
      { kind: 'para', text: 'Minnesota Statutes 2024, section 62A.011, is amended to read:' },
      { kind: 'heading', number: 'Subd. 3.', text: 'Health plan.' },
      { kind: 'para', text: '"Health plan" means a policy.' },
    ];
    const body = parseStructuredBody(blocks, { hasTitle: false });
    expect(body.leadIn).toMatch(/^Minnesota Statutes 2024/);
    expect(asHeadingCaption(body.caption)).toBe('Subd. 3. Health plan');
    expect(body.blocks.map((b) => b.kind)).toEqual(['para']);
  });

  it('classifies numbered clauses and roman sub-clauses as the flat path does', () => {
    const blocks: SourceBlock[] = [
      { kind: 'para', text: 'The following apply:' },
      { kind: 'para', text: '(1) a licensed program;' },
      { kind: 'para', text: '(i) operating under chapter 245D;' },
      { kind: 'para', text: 'This section is effective August 1, 2026.' },
    ];
    expect(parseStructuredBody(blocks, { hasTitle: true }).blocks.map((b) => b.kind)).toEqual([
      'para',
      'clause',
      'subclause',
      'para',
    ]);
  });
});
