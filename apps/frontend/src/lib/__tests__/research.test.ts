import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { researchPageMetadata } from '../share';
import {
  PUBLISHED_RESEARCH,
  WORDS_PER_MINUTE,
  indexedResearch,
  isoMonthYearCapsLabel,
  pieceAddressFolder,
  pieceCardCta,
  pieceCardMetaLine,
  pieceKindLabel,
  pieceMastheadLine,
  pieceReadingMinutes,
  pieceShareDescription,
  pieceSourcesLabel,
  pieceWordCount,
  pieceWrittenLine,
  piecePath,
  piecesLabelledGuide,
  piecesLabelledResearch,
  publishedResearch,
  researchBySlug,
  researchRunsText,
  isoDateCapsLabel,
  isoDateLabel,
  researchDatesLine,
  researchSectionAnchor,
  researchSectionAnchors,
  researchShareDescription,
  researchSharePanelDescription,
  type ResearchBlock,
  type ResearchPiece,
} from '../research';

const HERE = dirname(fileURLToPath(import.meta.url));

// A populated piece that exists ONLY here: nothing a reader can reach may show
// a figure or a claim from an unpublished piece, so the populated states are
// exercised with obviously-fake sample content instead of the real text
// (Eugene's 19 Aug 2026 decision — build the page and its container only).
export const SAMPLE_PIECE: ResearchPiece = {
  slug: 'sample-piece',
  traits: { research: true, guide: false },
  indexed: true,
  title: 'Sample piece title',
  dek: 'A sample standfirst for tests.',
  authorLine: 'ALETHICAL RESEARCH · AUTHOR NAMED AT PUBLISH',
  publishedOn: '2026-08-17',
  recordsThrough: '2026-08-11',
  filingBodies: ['Minnesota Campaign Finance Board', 'Federal Election Commission'],
  shortVersion: [
    { kind: 'paragraph', runs: [{ kind: 'text', text: 'A sample opening paragraph.' }] },
  ],
  sections: [
    {
      heading: 'A sample section',
      railLabel: 'Sample section',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'A figure of $3 sample appears here.' }],
        },
      ],
      methodologyInset: {
        title: 'How we scored this',
        body: 'A sample method note stating its own records-through window.',
      },
    },
  ],
  sources: [
    {
      text: 'A sample source.',
      note: 'A sample clarifying note.',
      noteLink: { text: 'a sample outward link', href: 'https://example.com/' },
    },
  ],
  correction: {
    datedLabel: 'CORRECTED SEP 2 2026',
    note: 'A sample correction note saying what changed. The text itself carries the corrected figure.',
  },
  newerFilingsNote: 'A sample newer-filings note, dated at the figure it moves.',
};

describe('the posted-research registry', () => {
  // Rule 13's publishing order: posting a piece puts it on the site straight
  // away, and holding it back from SEARCH ENGINES is the separate, later step.
  // These pins are what keep those two apart, so neither can drag the other.
  it('puts every posted piece on the site, at its address and on the /reading page', () => {
    expect(PUBLISHED_RESEARCH.length).toBeGreaterThan(0);
    // publishedResearch() is what the /reading page and the money landing's count read.
    expect(publishedResearch()).toEqual(PUBLISHED_RESEARCH);
    for (const piece of PUBLISHED_RESEARCH) {
      expect(researchBySlug(piece.slug)).toBe(piece);
    }
  });

  it('keeps a piece out of the sitemap until its figures are checked', () => {
    // Written as an equality so the guard still does work on a day when every
    // posted piece happens to be indexed.
    expect(indexedResearch()).toEqual(PUBLISHED_RESEARCH.filter((piece) => piece.indexed));
    expect(indexedResearch().every((piece) => piece.indexed)).toBe(true);
  });

  it('tells search engines to skip a piece until it is opened to them', () => {
    const held = researchPageMetadata({ ...SAMPLE_PIECE, indexed: false });
    expect(held.noindex).toBe(true);
    // No canonical while noindex: a held page is not a copy of a real one.
    expect(held.canonicalPath).toBe('');

    const open = researchPageMetadata(SAMPLE_PIECE);
    expect(open.noindex).toBe(false);
    expect(open.canonicalPath).toBe('/reading/research/sample-piece');
  });

  it('names records it does not hold rather than dating them', () => {
    // Rule 13's publishing order.
    for (const piece of PUBLISHED_RESEARCH) {
      if (piece.undatedRecordsNote === undefined) continue;
      expect(piece.undatedRecordsNote.trim().length).toBeGreaterThan(0);
      expect(piece.undatedRecordsNote).not.toContain(piece.recordsThrough);
    }
  });
});

describe('piece date labels', () => {
  it('formats an ISO date without shifting a day with the time zone', () => {
    // new Date('2026-08-17') is UTC midnight, which is 16 Aug in Minnesota —
    // the hand parser must not inherit that bug.
    expect(isoDateLabel('2026-08-17')).toBe('Aug 17, 2026');
    expect(isoDateLabel('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('formats the mono-caps masthead form', () => {
    expect(isoDateCapsLabel('2026-08-17')).toBe('AUG 17 2026');
  });

  it('passes through a value it cannot parse rather than inventing a date', () => {
    expect(isoDateLabel('unknown')).toBe('unknown');
  });

  it('writes the masthead dates line from both dates', () => {
    expect(researchDatesLine(SAMPLE_PIECE)).toBe(
      'PUBLISHED AUG 17 2026 · RECORDS THROUGH AUG 11 2026',
    );
  });
});

describe('piece share previews', () => {
  // Rule 13: piece claims and derived labels appear in no social-share preview
  // or metadata — a preview carries the title and the two dates, nothing else.
  it('describes a piece by its dates only', () => {
    expect(researchShareDescription(SAMPLE_PIECE)).toBe(
      'Published Aug 17, 2026 · records through Aug 11, 2026.',
    );
  });

  it('shows only the publication date inside the Share panel', () => {
    expect(researchSharePanelDescription(SAMPLE_PIECE)).toBe('Published Aug 17, 2026');
  });
});

describe('section link targets', () => {
  // Rule 13: a posted piece's addresses are stable. These are the seven
  // addresses "The Money Only Goes One Way" has been shareable at since it
  // posted, so a change to the slug rule that would break a link someone
  // already sent fails here rather than on the live page.
  it('keeps the posted piece\u2019s section addresses exactly as published', () => {
    const piece = researchBySlug('the-money-only-goes-one-way');
    expect(piece).toBeDefined();
    expect(researchSectionAnchors(piece!.sections)).toEqual([
      'start-with-your-own-check',
      'the-one-way-valve',
      'but-the-party-spends-on-the-candidates-behalf',
      'why-this-isnt-a-party-story',
      'the-number-that-dwarfs-all-of-it',
      'what-the-shape-actually-looks-like',
      'what-to-do-about-it',
    ]);
  });

  it('builds the address from the heading\u2019s own words, never its position', () => {
    expect(researchSectionAnchor('The one-way valve')).toBe('the-one-way-valve');
    // An apostrophe closes up rather than splitting the word in two.
    expect(researchSectionAnchor("Why this isn't a party story")).toBe(
      'why-this-isnt-a-party-story',
    );
    expect(
      researchSectionAnchor('\u201cBut the party spends on the candidate\u2019s behalf\u201d'),
    ).toBe('but-the-party-spends-on-the-candidates-behalf');
    // Punctuation, runs of spaces and edge punctuation all collapse away.
    expect(researchSectionAnchor('  What to do about it?  ')).toBe('what-to-do-about-it');
    expect(researchSectionAnchor('$221 million, in six accounts')).toBe(
      '221-million-in-six-accounts',
    );
  });

  it('gives a heading with nothing to slug a name rather than an empty address', () => {
    expect(researchSectionAnchor('\u2014 \u2014')).toBe('section');
  });

  it('numbers two headings that would otherwise share one address', () => {
    expect(
      researchSectionAnchors([
        { heading: 'What to do about it' },
        { heading: 'What to do about it' },
        { heading: 'What to do about it?' },
      ]),
    ).toEqual(['what-to-do-about-it', 'what-to-do-about-it-2', 'what-to-do-about-it-3']);
  });

  it('lists one address per section, in the order the article reads', () => {
    for (const piece of PUBLISHED_RESEARCH) {
      const anchors = researchSectionAnchors(piece.sections);
      expect(anchors).toHaveLength(piece.sections.length);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});

// A guide-shaped sample, for the states no posted guide is in. Obviously fake
// content, for the same reason SAMPLE_PIECE is: nothing a reader can reach may
// show a figure from a piece nobody published.
export const SAMPLE_GUIDE: ResearchPiece = {
  slug: 'sample-guide',
  traits: { research: false, guide: true },
  set: { name: 'A Sample Set', position: 3 },
  indexed: true,
  title: 'A sample guide title',
  dek: '',
  authorLine: 'ALETHICAL',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-12',
  filingBodies: ['Minnesota Campaign Finance Board'],
  shortVersion: [],
  intro: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'A sample opening line.' }] }],
  sections: [
    {
      heading: 'A sample guide section',
      railLabel: 'A sample guide section',
      blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'A sample sentence.' }] }],
    },
  ],
  sources: [],
  sourceRuns: [
    [
      { kind: 'text', text: 'A sample source: the Board\u2019s ' },
      { kind: 'externalLink', text: 'sample handbook', href: 'https://cfb.mn.gov/sample/' },
      { kind: 'text', text: ' and ' },
      { kind: 'externalLink', text: 'sample statute', href: 'https://www.revisor.mn.gov/sample/' },
      { kind: 'text', text: '.' },
    ],
  ],
};

describe('the 2 trait flags decide the label and the address', () => {
  // docs/architecture/published-writing-decisions.md §2.7 and §2.8. Two flags
  // rather than 1 kind, because a piece can carry both and planned guide 2
  // already does: it adds a figure up across legislators, which is rule 13's
  // first special permission.
  it('labels a piece Research when it carries the research trait, Guide otherwise', () => {
    expect(pieceKindLabel({ traits: { research: true, guide: false } })).toBe('Research');
    expect(pieceKindLabel({ traits: { research: false, guide: true } })).toBe('Guide');
  });

  it('shows 1 label on a both-traits piece, and it is the stricter one', () => {
    // Two labels would tell a reader that 2 sets of promises apply when only
    // rule 13 governs.
    expect(pieceKindLabel({ traits: { research: true, guide: true } })).toBe('Research');
  });

  it('addresses a both-traits piece under research, because rule 13 binds it in full', () => {
    expect(pieceAddressFolder({ traits: { research: true, guide: true } })).toBe('research');
    expect(pieceAddressFolder({ traits: { research: false, guide: true } })).toBe('guides');
    expect(piecePath(SAMPLE_GUIDE)).toBe('/reading/guides/sample-guide');
    expect(piecePath(SAMPLE_PIECE)).toBe('/reading/research/sample-piece');
  });

  it('sorts every posted piece into exactly 1 of the page\u2019s 2 groups', () => {
    const grouped = [...piecesLabelledResearch(), ...piecesLabelledGuide()];
    expect(grouped).toHaveLength(PUBLISHED_RESEARCH.length);
    expect(new Set(grouped.map((piece) => piece.slug)).size).toBe(PUBLISHED_RESEARCH.length);
    expect(piecesLabelledResearch().every((piece) => piece.traits.research)).toBe(true);
    expect(piecesLabelledGuide().every((piece) => !piece.traits.research)).toBe(true);
  });

  it('gives every posted piece 1 address, and never the other folder', () => {
    for (const piece of PUBLISHED_RESEARCH) {
      expect(piecePath(piece)).toBe(
        `/reading/${pieceAddressFolder(piece)}/${encodeURIComponent(piece.slug)}`,
      );
      // A piece with neither trait would be labelled Guide by default, which
      // would be an accident rather than a decision.
      expect(piece.traits.research || piece.traits.guide).toBe(true);
    }
  });

  it('stores its sources in exactly 1 of the 2 shapes', () => {
    for (const piece of PUBLISHED_RESEARCH) {
      const hasList = piece.sources.length > 0;
      const hasRuns = (piece.sourceRuns ?? []).length > 0;
      expect(hasList !== hasRuns).toBe(true);
    }
  });
});

describe('set membership, and the number a reader never sees', () => {
  // §2.12, Eugene 27 Aug 2026: no reader-facing surface prints a piece's position
  // in its set. Not "piece 1", not "piece 1 of 5", not a numbered row.
  it('names the set and nothing else on every line a reader reads', () => {
    const guide = researchBySlug('who-has-to-report-their-money');
    expect(guide?.set?.name).toBe('How the Money Works');
    expect(guide?.set?.position).toBe(1);

    const readerLines = [
      guide!.title,
      guide!.dek,
      guide!.set!.name,
      pieceMastheadLine(guide!),
      pieceCardMetaLine(guide!),
      pieceCardCta(guide!),
      pieceShareDescription(guide!),
    ].join(' \u2014 ');
    expect(readerLines).toContain('How the Money Works');
    for (const banned of ['piece 1', 'Piece 1', 'PIECE 1', '1 of 5', 'of 5']) {
      expect(readerLines).not.toContain(banned);
    }
  });

  it('lets a piece exist outside every set', () => {
    // §2.2: forbidding it would force a fake set the first time a standalone
    // piece is worth writing.
    expect(researchBySlug('the-money-only-goes-one-way')?.set).toBeUndefined();
  });
});

describe('reading time, computed from the piece\u2019s own words', () => {
  // §4.3, and the 25 Aug 2026 ruling: never typed, because a typed number goes
  // stale the first time a sentence changes.
  it('counts the guide at 5 minutes', () => {
    const guide = researchBySlug('who-has-to-report-their-money')!;
    expect(pieceReadingMinutes(guide)).toBe(5);
    // The words themselves, so a rewrite that changes the minutes is visible here
    // rather than only on the page.
    expect(pieceWordCount(guide)).toBeGreaterThan(900);
    expect(pieceWordCount(guide)).toBeLessThan(1100);
  });

  it('reads every kind of block, so no part of a piece is uncounted', () => {
    const blocks: ResearchBlock[] = [
      { kind: 'paragraph', runs: [{ kind: 'text', text: 'one two three' }] },
      { kind: 'bullets', items: [[{ kind: 'text', text: 'four five' }]] },
      { kind: 'note', text: 'six seven' },
      { kind: 'table', columns: ['eight'], rows: [['nine ten']] },
    ];
    const counted = pieceWordCount({
      ...SAMPLE_PIECE,
      shortVersion: [],
      intro: blocks,
      sections: [],
      sources: [],
      sourceRuns: [],
    });
    expect(counted).toBe(10);
  });

  it('rounds to whole minutes and never reports 0', () => {
    const words = (count: number): ResearchBlock[] => [
      { kind: 'paragraph', runs: [{ kind: 'text', text: Array(count).fill('word').join(' ') }] },
    ];
    const minutes = (count: number) =>
      pieceReadingMinutes({
        ...SAMPLE_PIECE,
        shortVersion: [],
        intro: words(count),
        sections: [],
        sources: [],
        sourceRuns: [],
      });
    expect(WORDS_PER_MINUTE).toBe(200);
    expect(minutes(1)).toBe(1);
    expect(minutes(99)).toBe(1);
    expect(minutes(300)).toBe(2);
    expect(minutes(970)).toBe(5);
  });
});

describe('the written-or-checked date', () => {
  // Settled 26 Aug 2026, §4.4: 1 slot, 1 word swapped, never a second date. A
  // "Checked" date that never moves would say we stopped looking, so the word
  // follows the fact.
  it('says Written until somebody re-checks the piece, and Checked after', () => {
    expect(pieceWrittenLine({ publishedOn: '2026-08-27' })).toBe('WRITTEN AUGUST 2026');
    expect(pieceWrittenLine({ publishedOn: '2026-08-27', checkedOn: '2027-03-04' })).toBe(
      'CHECKED MARCH 2027',
    );
  });

  it('prints month and year, never a day, and never shifts a month by time zone', () => {
    expect(isoMonthYearCapsLabel('2026-01-01')).toBe('JANUARY 2026');
    expect(isoMonthYearCapsLabel('2026-12-31')).toBe('DECEMBER 2026');
    expect(isoMonthYearCapsLabel('unknown')).toBe('UNKNOWN');
  });

  it('leaves the publication date alone when a checked date arrives', () => {
    const checked = { ...SAMPLE_GUIDE, checkedOn: '2027-03-04' };
    expect(pieceWrittenLine(checked)).toBe('CHECKED MARCH 2027');
    expect(checked.publishedOn).toBe(SAMPLE_GUIDE.publishedOn);
    // One date on the line, not two.
    expect(pieceMastheadLine(checked)).not.toContain('AUGUST 2026');
  });
});

describe('a guide\u2019s masthead', () => {
  it('reads kind, minutes and the 1 date, with no piece number', () => {
    const guide = researchBySlug('who-has-to-report-their-money')!;
    expect(pieceMastheadLine(guide)).toBe('GUIDE \u00b7 5 MIN \u00b7 WRITTEN AUGUST 2026');
  });

  it('leaves a research piece\u2019s masthead at its 2 dates and nothing else', () => {
    // Rule 13's publishing order, point 8. No kind word and no minutes join it.
    expect(pieceMastheadLine(SAMPLE_PIECE)).toBe(researchDatesLine(SAMPLE_PIECE));
    expect(pieceMastheadLine(SAMPLE_PIECE)).not.toContain('MIN');
    expect(pieceMastheadLine(SAMPLE_PIECE)).not.toContain('RESEARCH');
  });

  it('describes a guide by its 1 date in a share preview', () => {
    expect(pieceShareDescription(SAMPLE_GUIDE)).toBe('Written August 2026.');
    expect(pieceShareDescription(SAMPLE_PIECE)).toBe(researchShareDescription(SAMPLE_PIECE));
  });

  it('labels the sources block in the piece\u2019s own words', () => {
    expect(pieceSourcesLabel(SAMPLE_GUIDE)).toBe('WHERE THIS COMES FROM');
    expect(pieceSourcesLabel(SAMPLE_PIECE)).toBe('WHERE THESE NUMBERS COME FROM');
  });

  it('names what the reader is about to read on a card', () => {
    expect(pieceCardCta(SAMPLE_GUIDE)).toBe('Read the guide \u2192');
    expect(pieceCardCta(SAMPLE_PIECE)).toBe('Read the research \u2192');
  });

  it('carries a guide\u2019s minutes on its card and no date', () => {
    expect(pieceCardMetaLine(SAMPLE_GUIDE)).toBe(`${pieceReadingMinutes(SAMPLE_GUIDE)} MIN`);
    expect(pieceCardMetaLine(SAMPLE_PIECE)).toBe('PUBLISHED AUG 17 2026');
  });
});

/**
 * The guide's prose was written and settled in
 * `docs/reader-guides/who-has-to-report-their-money.md` before any container
 * existed for it, and rule 13 forbids editing a posted piece's words. So this
 * compares the shipped piece, word for word, against that file: a sentence
 * re-punctuated, trimmed, dropped or reordered on either side fails here rather
 * than on the live page.
 *
 * The 2 deliberate conversions are accounted for rather than excused. The set
 * line is stored as set membership, and the italic "Where this comes from."
 * lead-in becomes the sources block's own label, so the label's words are
 * reconstructed from `pieceSourcesLabel` and have to match the words in the file.
 */
describe('the shipped guide is the settled prose, word for word', () => {
  const guide = researchBySlug('who-has-to-report-their-money')!;

  const blockText = (blocks: readonly ResearchBlock[]): string[] =>
    blocks.flatMap((block) => {
      if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
      if (block.kind === 'bullets') return block.items.map(researchRunsText);
      if (block.kind === 'note') return [block.text];
      return [...block.columns, ...block.rows.flat()];
    });

  const shipped = [
    guide.title,
    guide.set!.name,
    ...blockText(guide.intro ?? []),
    ...guide.sections.flatMap((section) => [section.heading, ...blockText(section.blocks)]),
    pieceSourcesLabel(guide)
      .toLowerCase()
      .replace(/^./, (first) => first.toUpperCase()) + '.',
    ...(guide.sourceRuns ?? []).map(researchRunsText),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fromDoc = readFileSync(
    join(HERE, '../../../../..', 'docs/reader-guides/who-has-to-report-their-money.md'),
    'utf8',
  )
    // The opening HTML comments are the doc-sync declaration and a note to
    // whoever maintains the page, never words a reader sees.
    .replace(/^(?:\s*<!--[\s\S]*?-->)+/, '')
    // Markdown marks, not words: link syntax keeps its text and drops its
    // address, which the sources block serves separately as real anchors.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^---$/gm, '')
    .replace(/^#+ /gm, '')
    // A bullet's dash is a mark; its words are the same words the page draws.
    .replace(/^- /gm, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  it('ships every word the settled draft holds, in the draft\u2019s own order', () => {
    expect(shipped).toBe(fromDoc);
  });

  it('carries the structure the draft gives it', () => {
    expect(guide.sections).toHaveLength(7);
    expect(
      guide.sections.filter((section) => section.blocks.some((b) => b.kind === 'bullets')),
    ).toHaveLength(1);
    expect(
      guide.sections.flatMap((section) => section.blocks).filter((b) => b.kind === 'bullets'),
    ).toHaveLength(2);
    // Bold inside 2 paragraphs, and nowhere else.
    const boldParagraphs = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)]
      .filter((block) => block.kind === 'paragraph')
      .filter((block) => block.runs.some((run) => run.kind === 'bold'));
    expect(boldParagraphs).toHaveLength(2);
  });

  it('links every source it names, at the Board and at the statutes', () => {
    const links = (guide.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => (run as { href: string }).href);
    expect(links).toHaveLength(11);
    expect(links.filter((href) => href.includes('cfb.mn.gov'))).toHaveLength(8);
    expect(links.filter((href) => href.includes('revisor.mn.gov'))).toHaveLength(3);
    expect(links.every((href) => href.startsWith('https://'))).toBe(true);
  });

  it('carries no link out of its body, because its destinations are unwritten', () => {
    // Issue 1752's linking rule 6, and §2.6: a person authors every term link,
    // and a forward link goes in when its destination posts, not before.
    const bodyRuns = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)].flatMap(
      (block) =>
        block.kind === 'paragraph'
          ? block.runs
          : block.kind === 'bullets'
            ? block.items.flat()
            : [],
    );
    expect(bodyRuns.some((run) => run.kind === 'externalLink')).toBe(false);
  });
});
