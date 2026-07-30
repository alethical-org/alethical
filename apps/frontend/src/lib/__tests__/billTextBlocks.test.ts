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
  asHeadingCaption,
  blockTexts,
  changeKindsPresent,
  headingLabel,
  parseChangeRuns,
  parseSectionBody,
  parseStructuredBody,
  plainSectionText,
  sectionIndexLabel,
  splitSectionLabel,
  SourceBlock,
} from '../billText';
import sections from './fixtures/bill-text-body-blocks.json';

type Section = (typeof sections)[number];

const MARKER_WORDS = /(?:deleted|new) text (?:begin|end)/i;

function blocksOf(section: Section): SourceBlock[] {
  return section.bodyBlocks as SourceBlock[];
}

/** The strings FullTextTab.tsx paints for one section, on the structured path. */
function renderedStrings(section: Section): string[] {
  const { number, title } = splitSectionLabel(section.heading);
  const body = parseStructuredBody(blocksOf(section), { hasTitle: !!title });
  const heading = title ?? asHeadingCaption(body.caption);
  const runs = [
    ...(body.leadIn ? parseChangeRuns(body.leadIn) : []),
    ...body.blocks.flatMap((block) => parseChangeRuns(block.text)),
  ];
  return [
    number,
    heading,
    sectionIndexLabel(section.heading, section.text, blocksOf(section)),
    ...runs.map((run) => run.text),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/** Everything a body renders, with all whitespace removed. */
function squashed(body: {
  leadIn: string | null;
  caption: string | null;
  blocks: Array<{ text: string }>;
}): string {
  return plainSectionText(
    [body.leadIn ?? '', body.caption ?? '', ...body.blocks.map((b) => b.text)].join(' '),
  ).replace(/\s+/g, '');
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
      const body = parseStructuredBody(blocksOf(section), { hasTitle: !!title });
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
      const body = parseStructuredBody(blocksOf(section), { hasTitle: !!title });
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

describe('property 6: the structured body renders every character the flat body does', () => {
  // Compared with whitespace stripped, not word by word: keeping the marker words
  // splits tokens the flat text had glued together — an added "(4)" followed by
  // ", applies" flattened to the single token "(4)," — so a word comparison
  // reports a difference that is not a loss.
  it('holds for every fixture section', () => {
    for (const section of sections) {
      const { title } = splitSectionLabel(section.heading);
      const flat = squashed(parseSectionBody(section.text, { hasTitle: !!title }));
      const structured = squashed(parseStructuredBody(blocksOf(section), { hasTitle: !!title }));
      let cursor = 0;
      for (const character of flat) {
        cursor = structured.indexOf(character, cursor) + 1;
        if (cursor === 0) break;
      }
      expect(cursor, `${withId(section)} drops wording the flat text renders`).not.toBe(0);
    }
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
      const structured = parseStructuredBody(blocksOf(section), { hasTitle: !!title });
      const shown = [structured.caption ?? '', ...structured.blocks.map((b) => b.text)].join(' ');
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

describe('a captured table', () => {
  it('keeps every cell it captured, as one paragraph each until #752 lays it out', () => {
    const tabled = sections.filter((s) => blocksOf(s).some((b) => b.kind === 'table'));
    expect(tabled.length).toBeGreaterThan(0);
    for (const section of tabled) {
      const cells = blocksOf(section)
        .flatMap((b) => (b.kind === 'table' ? b.rows.flat() : []))
        .map((cell) => plainSectionText(cell.text))
        .filter(Boolean);
      const rendered = parseStructuredBody(blocksOf(section), { hasTitle: false })
        .blocks.map((b) => plainSectionText(b.text))
        .join(' ');
      for (const cell of cells) {
        expect(rendered, `${withId(section)} lost the cell "${cell}"`).toContain(cell);
      }
    }
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
