import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { researchPageMetadata } from '../share';
import {
  PUBLISHED_RESEARCH,
  READ_PAGE_EMPTY_BODY,
  READ_PAGE_EMPTY_TITLE,
  READ_PAGE_INTRO,
  WORDS_PER_MINUTE,
  indexedResearch,
  isoMonthYearCapsLabel,
  pieceAddressFolder,
  pieceCardMetaLine,
  pieceCardSecondaryLine,
  pieceContentsLabel,
  pieceRowTime,
  pieceSetSlug,
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
  publishedSets,
  guidesOutsideEverySet,
  setMetaLine,
  setReadingMinutes,
  isoDateCommaCapsLabel,
  researchBySlug,
  researchRunsText,
  researchSourceText,
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

describe('every forward link in the set', () => {
  // Each forward href is a LITERAL in the piece that carries it, never computed
  // from its destination's slug, because the destination imports the piece back to
  // build its own return link and importing both ways would be a module-scope
  // cycle. These assertions are what make the literals safe: a slug change fails
  // here rather than dangling on a live page.
  const chain = [
    { from: 'who-has-to-report-their-money', to: 'what-the-records-name' },
    { from: 'what-the-records-name', to: 'why-2-official-numbers-can-both-be-right' },
    { from: 'why-2-official-numbers-can-both-be-right', to: 'money-spent-without-a-campaigns-say' },
    { from: 'money-spent-without-a-campaigns-say', to: 'why-nobody-can-follow-a-dollar' },
  ];

  it.each(chain)('resolves $from to $to rather than dangling', ({ from, to }) => {
    const destination = researchBySlug(to);
    expect(destination).toBeDefined();
    const source = researchBySlug(from);
    expect(source).toBeDefined();
    const hrefs = JSON.stringify(source).match(/\/read\/guides\/[a-z0-9-]+/g) ?? [];
    expect(hrefs).toContain(piecePath(destination!));
  });

  it('leaves the last piece promising nothing, because nothing is committed', () => {
    // §2.3 and rule 2: a set names only its published pieces, so the last piece
    // carries no hand-off. This fails the day someone adds one without a sixth
    // piece to point at.
    const last = researchBySlug('why-nobody-can-follow-a-dollar')!;
    const text = [
      ...(last.intro ?? []),
      ...last.sections.flatMap((section) => section.blocks),
    ].flatMap((block) =>
      block.kind === 'paragraph'
        ? [researchRunsText(block.runs)]
        : block.kind === 'bullets'
          ? block.items.map(researchRunsText)
          : [],
    );
    expect(last.sections.map((section) => section.heading)).not.toContain('Next');
    expect(text.join(' ')).not.toContain('the next piece in this set');
  });
});

describe('the posted-research registry', () => {
  // Rule 13's publishing order: posting a piece puts it on the site straight
  // away, and holding it back from SEARCH ENGINES is the separate, later step.
  // These pins are what keep those two apart, so neither can drag the other.
  it('puts every posted piece on the site, at its address and on the /read page', () => {
    expect(PUBLISHED_RESEARCH.length).toBeGreaterThan(0);
    // publishedResearch() is what the /read page and the money landing's count read.
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
    expect(open.canonicalPath).toBe('/read/research/sample-piece');
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
    expect(piecePath(SAMPLE_GUIDE)).toBe('/read/guides/sample-guide');
    expect(piecePath(SAMPLE_PIECE)).toBe('/read/research/sample-piece');
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
        `/read/${pieceAddressFolder(piece)}/${encodeURIComponent(piece.slug)}`,
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
      pieceCardSecondaryLine(guide!),
      pieceRowTime(guide!),
      pieceShareDescription(guide!),
    ].join(' | ');
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

  it('gives both kinds of card one shape: minutes, then a date', () => {
    // A column of cards that changes shape per kind reads as 2 columns, so the
    // slots are the same and only the date word differs (Design, 27 Aug 2026).
    expect(pieceCardMetaLine(SAMPLE_PIECE)).toBe(
      `${pieceReadingMinutes(SAMPLE_PIECE)} MIN \u00b7 PUBLISHED AUG 17, 2026`,
    );
    expect(pieceCardMetaLine(SAMPLE_GUIDE)).toBe(
      `${pieceReadingMinutes(SAMPLE_GUIDE)} MIN \u00b7 WRITTEN AUGUST 2026`,
    );
  });

  it('swaps one word on a card once a guide has been re-checked', () => {
    const checked = { ...SAMPLE_GUIDE, checkedOn: '2027-03-04' };
    expect(pieceCardMetaLine(checked)).toBe(
      `${pieceReadingMinutes(checked)} MIN \u00b7 CHECKED MARCH 2027`,
    );
    // Same slot, never a second date.
    expect(pieceCardMetaLine(checked)).not.toContain('WRITTEN');
  });

  it('puts a comma in a card\u2019s date and none in a masthead\u2019s', () => {
    expect(isoDateCommaCapsLabel('2026-08-20')).toBe('AUG 20, 2026');
    expect(isoDateCapsLabel('2026-08-20')).toBe('AUG 20 2026');
  });

  it('shares one smaller line between the 2 kinds of card', () => {
    // A research piece puts its standfirst there; a guide puts its set.
    expect(pieceCardSecondaryLine(SAMPLE_PIECE)).toBe(SAMPLE_PIECE.dek);
    expect(pieceCardSecondaryLine(SAMPLE_GUIDE)).toBe('A Sample Set');
    // A guide outside every set has nothing to put there, so nothing is drawn.
    expect(pieceCardSecondaryLine({ ...SAMPLE_GUIDE, set: undefined })).toBe('');
  });
});

/**
 * Rule 13 forbids editing a posted piece's words, so this compares each shipped
 * piece, word for word, against its own file in `docs/reader-guides/`: a sentence
 * re-punctuated, trimmed, dropped or reordered on either side fails here rather
 * than on the live page.
 *
 * THE 6 FILES CARRY 2 DIFFERENT GUARANTEES, and each file's opening comment says
 * which one it is. The 5 guides' prose was written and settled in that folder
 * before any container existed for it, so the file is the author's manuscript and
 * the page is the copy. *The Money Only Goes One Way* was transcribed straight
 * into `researchPieces/moneyOnlyGoesOneWay.ts` in August 2026 and never had a
 * file, so its file was written from the shipped piece on 31 Aug 2026 and pins
 * what shipped rather than what the author wrote. The weaker guarantee is still
 * the one this block needs: from here on a sentence cannot change in the code
 * alone (issue 1832).
 *
 * The 4 deliberate conversions are accounted for rather than excused. A guide's
 * set line is stored as set membership; the italic "Where this comes from."
 * lead-in becomes the sources block's own label, so the label's words are
 * reconstructed from `pieceSourcesLabel` and have to match the words in the file;
 * a link's address is dropped on both sides, keeping only its words, because the
 * page serves every address separately as a real anchor; and a table's pipes are
 * dropped, because the page draws the same cells as a real table.
 */
const blockText = (blocks: readonly ResearchBlock[]): string[] =>
  blocks.flatMap((block) => {
    if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
    if (block.kind === 'bullets') return block.items.map(researchRunsText);
    if (block.kind === 'note') return [block.text];
    return [...block.columns, ...block.rows.flat()];
  });

/**
 * Every word the shipped piece draws, in the order `ResearchScreen.tsx` draws it.
 *
 * Every field a piece can draw words from is read here, including the ones no
 * piece uses today, because a field left out is a field where a sentence can be
 * dropped and no test notices — which is the whole reason issue 1832 exists.
 */
function shippedWords(piece: ResearchPiece): string {
  return [
    piece.title,
    // The 2 lines under the title, in the order the masthead draws them: a guide
    // names its set there, a research piece its standfirst, and no piece has both.
    piece.set?.name ?? '',
    piece.dek,
    ...blockText(piece.shortVersion),
    ...blockText(piece.intro ?? []),
    ...piece.sections.flatMap((section) => [
      section.heading,
      ...blockText(section.blocks),
      // The method box, drawn after its section's prose. Its title is stored in
      // sentence case and uppercased by the layout, so the stored words are what
      // the file holds.
      ...(section.methodologyInset
        ? [section.methodologyInset.title, section.methodologyInset.body]
        : []),
    ]),
    pieceSourcesLabel(piece)
      .toLowerCase()
      .replace(/^./, (first) => first.toUpperCase()) + '.',
    ...piece.sources.map(researchSourceText),
    ...piece.sources.flatMap((source) => (source.noteLink ? [source.noteLink.text] : [])),
    ...(piece.sourceRuns ?? []).map(researchRunsText),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same words as the file holds them, with markdown marks removed. */
function draftWords(file: string): string {
  return (
    readFileSync(join(HERE, '../../../../..', `docs/reader-guides/${file}`), 'utf8')
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
      // A table's header rule and its cell separators are marks too. The rule
      // goes first, or its dashes survive as words. The page draws the header
      // cells then each row, which is this file's own reading order.
      .replace(/^\|(?: *:?-+:? *\|)+$/gm, '')
      .replace(/\|/g, ' ')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

describe('every shipped piece is its settled prose, word for word', () => {
  const pieces = [
    { slug: 'who-has-to-report-their-money', file: 'who-has-to-report-their-money.md' },
    { slug: 'what-the-records-name', file: 'what-the-records-name.md' },
    {
      slug: 'why-2-official-numbers-can-both-be-right',
      file: 'why-2-official-numbers-can-both-be-right.md',
    },
    {
      slug: 'money-spent-without-a-campaigns-say',
      file: 'money-spent-without-a-campaigns-say.md',
    },
    { slug: 'why-nobody-can-follow-a-dollar', file: 'why-nobody-can-follow-a-dollar.md' },
    { slug: 'the-money-only-goes-one-way', file: 'the-money-only-goes-one-way.md' },
  ];

  it('has a settled file for every published piece, and no orphan files', () => {
    // Every published piece, not every guide: for 8 days the research piece was
    // the one posted thing no word-for-word check covered, and a guide-only list
    // is what let that sit unnoticed (issue 1832).
    expect(
      publishedResearch()
        .map((piece) => piece.slug)
        .sort(),
    ).toEqual(pieces.map((piece) => piece.slug).sort());
  });

  it.each(pieces)(
    'ships every word the settled file of $slug holds, in that file\u2019s own order',
    ({ slug, file }) => {
      expect(shippedWords(researchBySlug(slug)!)).toBe(draftWords(file));
    },
  );
});

describe('the first guide carries the structure its draft gives it', () => {
  const guide = researchBySlug('who-has-to-report-their-money')!;

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

describe('the second guide carries the structure its draft gives it', () => {
  const guide = researchBySlug('what-the-records-name')!;

  it('sits second in the set, and says so nowhere a reader looks', () => {
    expect(guide.set).toEqual({ name: 'How the Money Works', position: 2 });
    const readerLines = [
      guide.title,
      guide.dek,
      pieceMastheadLine(guide),
      pieceCardMetaLine(guide),
      pieceCardSecondaryLine(guide),
      pieceRowTime(guide),
      pieceShareDescription(guide),
      ...guide.sections.map((section) => section.heading),
    ].join(' | ');
    for (const banned of ['piece 2', 'Piece 2', 'PIECE 2', '2 of 5', 'of 5']) {
      expect(readerLines).not.toContain(banned);
    }
  });

  it('is 6 sections of plain paragraphs, with 1 bold phrase and no bullets', () => {
    expect(guide.sections).toHaveLength(6);
    const blocks = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)];
    expect(blocks.every((block) => block.kind === 'paragraph')).toBe(true);
    const bold = blocks
      .filter((block) => block.kind === 'paragraph')
      .flatMap((block) => block.runs)
      .filter((run) => run.kind === 'bold');
    // "must", in the sentence saying the $200 is a floor and not a ceiling.
    expect(bold.map((run) => run.text)).toEqual(['must']);
  });

  it('links every source it names, at the Board and at the statutes', () => {
    const links = (guide.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => run.href);
    expect(links).toHaveLength(7);
    expect(links.filter((href) => href.includes('cfb.mn.gov'))).toHaveLength(6);
    expect(links.filter((href) => href.includes('revisor.mn.gov'))).toHaveLength(1);
    expect(links.every((href) => href.startsWith('https://'))).toBe(true);
  });

  it('links back to the first guide twice, forward to the third once, and never outward', () => {
    // Issue 1752's linking rules: first use only, once per paragraph, and only to
    // what exists. The draft wrote all 3 as relative links between the drafts; the
    // shipped piece points them at the reader-facing addresses.
    const bodyRuns = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)].flatMap(
      (block) => (block.kind === 'paragraph' ? block.runs : []),
    );
    const inward = bodyRuns.filter((run) => run.kind === 'internalLink');
    expect(inward.map((run) => run.href)).toEqual([
      '/read/guides/who-has-to-report-their-money',
      '/read/guides/who-has-to-report-their-money',
      '/read/guides/why-2-official-numbers-can-both-be-right',
    ]);
    // Every destination is posted, which is the only reason a link may exist.
    for (const href of inward.map((run) => run.href)) {
      expect(PUBLISHED_RESEARCH.map(piecePath)).toContain(href);
    }
    // Each use sits in its own paragraph, never twice in one.
    const paragraphsWithInward = [
      ...(guide.intro ?? []),
      ...guide.sections.flatMap((s) => s.blocks),
    ].filter(
      (block) =>
        block.kind === 'paragraph' && block.runs.some((run) => run.kind === 'internalLink'),
    );
    expect(paragraphsWithInward).toHaveLength(3);
    expect(bodyRuns.some((run) => run.kind === 'externalLink')).toBe(false);
  });

  it('never reinstates the absolute its own draft withdrew', () => {
    // The draft's withdrawn item 4: "gifts of $200 or less are never named" is
    // false, and 334,234 rows of the Board's own file are the disproof
    // (grounded-answers rule 12; issue 1755).
    const prose = [
      ...blockText(guide.intro ?? []),
      ...guide.sections.flatMap((section) => blockText(section.blocks)),
    ].join(' ');
    expect(prose).not.toContain('never named');
    expect(prose).toContain('Some accounts name them anyway');
    expect(prose).toContain('$200 or less');
    expect(prose).not.toContain('under $200');
  });
});

describe('sets, as the /read page groups them', () => {
  it('groups the published guides into the set they were written for', () => {
    const sets = publishedSets(piecesLabelledGuide());
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe('How the Money Works');
    expect(sets[0].slug).toBe('how-the-money-works');
    // Reading order, which is what `position` is for and the only thing it is for.
    expect(sets[0].pieces.map((piece) => piece.slug)).toEqual([
      'who-has-to-report-their-money',
      'what-the-records-name',
      'why-2-official-numbers-can-both-be-right',
      'money-spent-without-a-campaigns-say',
      'why-nobody-can-follow-a-dollar',
    ]);
  });

  it('counts and totals from the rows, so neither can drift from the list', () => {
    const set = publishedSets(piecesLabelledGuide())[0];
    const rowMinutes = set.pieces.map(pieceReadingMinutes);
    expect(setReadingMinutes(set)).toBe(rowMinutes.reduce((a, b) => a + b, 0));
    expect(setMetaLine(set)).toBe(`${set.pieces.length} GUIDES · ${setReadingMinutes(set)} MIN`);
  });

  it('says GUIDE, not GUIDES, in a box holding 1 published piece', () => {
    // §2.5 ratified the 1-piece box, so this is a shipped state rather than a
    // hypothetical, and "1 GUIDES" would be visibly wrong on it.
    const single = publishedSets([researchBySlug('who-has-to-report-their-money')!])[0];
    expect(setMetaLine(single)).toBe(`1 GUIDE · ${pieceReadingMinutes(single.pieces[0])} MIN`);
  });

  it('draws no box for a set with nothing published', () => {
    // §2.4: a box with no rows tells a reader nothing and reads as broken. Its
    // own page stays reachable for anyone holding the link.
    expect(publishedSets([])).toEqual([]);
  });

  it('never names a piece a reader cannot open', () => {
    // §2.3: a set lists what is published and nothing else, so every row resolves.
    for (const set of publishedSets()) {
      for (const piece of set.pieces) {
        expect(publishedResearch()).toContain(piece);
        expect(researchBySlug(piece.slug)).toBe(piece);
      }
    }
  });

  it('holds only guides in every set that exists', () => {
    // The set box's meta line names GUIDES, which is right because every set
    // holds only guides. A set holding anything else needs a word nobody has
    // chosen, so this fails the day one appears rather than printing the wrong
    // noun at a reader.
    for (const set of publishedSets()) {
      expect(set.pieces.map(pieceKindLabel)).toEqual(set.pieces.map(() => 'Guide'));
    }
  });

  it('leaves a piece outside every set out of the boxes and in the cards', () => {
    // §2.2: a piece does not need a set, and the research piece has none.
    const research = researchBySlug('the-money-only-goes-one-way')!;
    expect(research.set).toBeUndefined();
    expect(publishedSets()).not.toContainEqual(
      expect.objectContaining({ pieces: expect.arrayContaining([research]) }),
    );
    // Today every published guide belongs to the one set, so no loose guide card
    // is drawn. This is the state, not an assumption baked into the page.
    expect(guidesOutsideEverySet()).toEqual([]);
  });

  it('slugs a set name the way a section heading is slugged', () => {
    expect(pieceSetSlug('How the Money Works')).toBe('how-the-money-works');
    expect(pieceSetSlug('Reading a Bill')).toBe('reading-a-bill');
  });

  it('gives a row a time and never a decimal', () => {
    for (const piece of publishedResearch()) {
      expect(pieceRowTime(piece)).toMatch(/^\d+ min$/);
    }
  });
});

describe('the 3 guides that complete the set', () => {
  const later = [
    { slug: 'why-2-official-numbers-can-both-be-right', position: 3, sections: 5 },
    { slug: 'money-spent-without-a-campaigns-say', position: 4, sections: 5 },
    { slug: 'why-nobody-can-follow-a-dollar', position: 5, sections: 5 },
  ];

  it.each(later)('posts $slug at its own address, labelled Guide', ({ slug }) => {
    const guide = researchBySlug(slug)!;
    expect(guide).toBeDefined();
    expect(pieceKindLabel(guide)).toBe('Guide');
    expect(pieceAddressFolder(guide)).toBe('guides');
    expect(piecePath(guide)).toBe(`/read/guides/${slug}`);
    // Rule 13's publishing order point 4: everything we publish is visible to
    // search engines from the day it posts.
    expect(guide.indexed).toBe(true);
    expect(indexedResearch()).toContain(guide);
  });

  it.each(later)('sits at position $position and prints no number', ({ slug, position }) => {
    const guide = researchBySlug(slug)!;
    expect(guide.set).toEqual({ name: 'How the Money Works', position });
    const readerLines = [
      guide.title,
      guide.dek,
      pieceMastheadLine(guide),
      pieceCardMetaLine(guide),
      pieceCardSecondaryLine(guide),
      pieceRowTime(guide),
      pieceShareDescription(guide),
      ...guide.sections.map((section) => section.heading),
    ].join(' | ');
    for (const banned of [`piece ${position}`, `Piece ${position}`, 'of 5', 'of 12']) {
      expect(readerLines).not.toContain(banned);
    }
  });

  it.each(later)('carries $sections sections and opens with an intro', ({ slug, sections }) => {
    const guide = researchBySlug(slug)!;
    expect(guide.sections).toHaveLength(sections);
    expect(guide.intro?.length).toBeGreaterThan(0);
    // A guide states rules rather than findings, so no SHORT VERSION box is drawn.
    expect(guide.shortVersion).toEqual([]);
    expect(guide.dek).toBe('');
  });

  it.each(later)('sources $slug entirely at the Board or the statutes', ({ slug }) => {
    const guide = researchBySlug(slug)!;
    const links = (guide.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => run.href);
    expect(links.length).toBeGreaterThan(0);
    expect(
      links.every((href) => href.includes('cfb.mn.gov') || href.includes('revisor.mn.gov')),
    ).toBe(true);
    expect(links.every((href) => href.startsWith('https://'))).toBe(true);
    expect(guide.sources).toEqual([]);
  });

  it.each(later)('points every inward link in $slug at a posted piece', ({ slug }) => {
    // Issue 1752's linking rule 6: a link goes in when its destination posts and
    // not before. Nothing in a body may leave the site, and no body link may point
    // at a page the registry does not hold.
    const guide = researchBySlug(slug)!;
    const bodyRuns = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)].flatMap(
      (block) =>
        block.kind === 'paragraph'
          ? block.runs
          : block.kind === 'bullets'
            ? block.items.flat()
            : [],
    );
    expect(bodyRuns.some((run) => run.kind === 'externalLink')).toBe(false);
    const inward = bodyRuns.filter((run) => run.kind === 'internalLink');
    expect(inward.length).toBeGreaterThan(0);
    const posted = PUBLISHED_RESEARCH.map(piecePath);
    for (const run of inward) {
      expect(posted).toContain(run.href);
    }
    // First use only, once per paragraph: no paragraph carries 2 inward links.
    const perParagraph = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)]
      .filter((block) => block.kind === 'paragraph')
      .map((block) => block.runs.filter((run) => run.kind === 'internalLink').length);
    expect(Math.max(0, ...perParagraph)).toBeLessThanOrEqual(1);
  });

  it('completes the set at 5 published guides, in reading order', () => {
    const inSet = piecesLabelledGuide()
      .filter((piece) => piece.set?.name === 'How the Money Works')
      .sort((a, b) => (a.set!.position ?? 0) - (b.set!.position ?? 0));
    expect(inSet.map((piece) => piece.set!.position)).toEqual([1, 2, 3, 4, 5]);
    expect(inSet.map((piece) => piece.slug)).toEqual([
      'who-has-to-report-their-money',
      'what-the-records-name',
      'why-2-official-numbers-can-both-be-right',
      'money-spent-without-a-campaigns-say',
      'why-nobody-can-follow-a-dollar',
    ]);
  });
});

describe('a line sitting on its own takes no closing period', () => {
  // Eugene, 2 Sep 2026: a period says another sentence is coming, so on a line
  // with nothing after it the eye waits for something that never arrives. The
  // rule reaches the lines the /read page writes itself; it does not reach an
  // explaining sentence inside a piece.
  it('ends the page’s own 3 lines without one', () => {
    for (const line of [READ_PAGE_INTRO, READ_PAGE_EMPTY_TITLE, READ_PAGE_EMPTY_BODY]) {
      expect(line.endsWith('.')).toBe(false);
    }
    expect(READ_PAGE_EMPTY_TITLE).toBe('Nothing published yet');
    expect(READ_PAGE_EMPTY_BODY).toBe(
      'When we publish research or a guide on these records, it appears here, dated and carrying the date its records run through',
    );
  });

  it('leaves a posted piece’s own standfirst exactly as its author wrote it', () => {
    // The card's secondary line for a research piece is the piece's standfirst,
    // and rule 13's publishing order point 2 forbids changing an author's words
    // to fit a rule of ours. So the /read page does draw one period, and the
    // no-period rule stops at the page's own lines.
    const withStandfirst = piecesLabelledResearch().filter((piece) => piece.dek !== '');
    expect(withStandfirst.length).toBeGreaterThan(0);
    for (const piece of withStandfirst) {
      expect(pieceCardSecondaryLine(piece)).toBe(piece.dek);
      expect(piece.dek.endsWith('.')).toBe(true);
    }
  });
});

describe('the contents list is announced by the piece’s own kind', () => {
  // An `accessibilityLabel` REPLACES an element's visible text for assistive
  // technology rather than adding to it (`.claude/rules/grounded-answers.md`
  // rule 10, and what a fixed label cost a bill page). The visible word is
  // "CONTENTS", so a fixed spoken label told a person who cannot see the screen
  // that a guide was research, and only that person ever met the wrong word.
  it('names research on a research piece and a guide on a guide', () => {
    expect(pieceContentsLabel({ traits: { research: true, guide: false } })).toBe(
      'Sections in this research',
    );
    expect(pieceContentsLabel({ traits: { research: false, guide: true } })).toBe(
      'Sections in this guide',
    );
    // A both-traits piece follows the stricter label, as every other derived
    // label on it does.
    expect(pieceContentsLabel({ traits: { research: true, guide: true } })).toBe(
      'Sections in this research',
    );
  });

  it('gives every posted piece a label naming the kind it is labelled', () => {
    for (const piece of PUBLISHED_RESEARCH) {
      expect(pieceContentsLabel(piece)).toBe(
        `Sections in this ${pieceKindLabel(piece).toLowerCase()}`,
      );
    }
  });

  it('wires that label into the screen, and never a fixed word', () => {
    // Vitest here runs pure logic with no DOM and cannot compute an accessible
    // name, so this reads the source. The computed name itself is read in a real
    // browser on a live guide and the live research piece.
    const source = readFileSync(
      join(HERE, '..', '..', 'screens', 'redesign', 'ResearchScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('accessibilityLabel={pieceContentsLabel(piece)}');
    expect(source).not.toMatch(/accessibilityLabel="Sections in this/);
    // The visible heading is unchanged: nothing here touches what a sighted
    // reader sees.
    expect(source).toContain('CONTENTS');
  });
});
