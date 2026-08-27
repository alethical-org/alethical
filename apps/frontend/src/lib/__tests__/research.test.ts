import { describe, expect, it } from 'vitest';

import { researchPageMetadata } from '../share';
import {
  PUBLISHED_RESEARCH,
  indexedResearch,
  publishedResearch,
  researchBySlug,
  isoDateCapsLabel,
  isoDateLabel,
  researchDatesLine,
  researchSectionAnchor,
  researchSectionAnchors,
  researchShareDescription,
  researchSharePanelDescription,
  type ResearchPiece,
} from '../research';

// A populated piece that exists ONLY here: nothing a reader can reach may show
// a figure or a claim from an unpublished piece, so the populated states are
// exercised with obviously-fake sample content instead of the real text
// (Eugene's 19 Aug 2026 decision — build the page and its container only).
export const SAMPLE_PIECE: ResearchPiece = {
  slug: 'sample-piece',
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
