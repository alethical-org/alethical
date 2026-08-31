import { describe, expect, it, vi } from 'vitest';

import sitemapHandler from '../../../../../api/sitemap';
import { renderPageSnapshot, researchPageSnapshot } from '../pageSnapshot';
import { PUBLISHED_RESEARCH, piecePath, researchBySlug } from '../research';

/**
 * The content `.claude/rules/grounded-answers.md` rule 13 requires a published
 * piece to CARRY, named here as literal strings.
 *
 * Why a separate file, and why literals. Every other check on these pieces builds
 * its expectation out of the piece it is checking: it counts the anchors the piece
 * stores, collects the sentences the piece stores, reads the inset off the piece.
 * Those checks catch the served page and the stored piece disagreeing, which is a
 * real failure and worth catching. They can never catch the piece simply not
 * carrying something, because the expectation disappears along with the thing it
 * was checking.
 *
 * Measured on 28 Aug 2026, before this file existed: deleting *The Money Only
 * Goes One Way*'s whole lobbying method box failed 0 of 1,735 tests, and so did
 * deleting each of the 4 statements rule 13 requires that box to make. Deleting
 * the "both-sides PAC" method box failed 0. Replacing the Campaign Finance
 * Board's name with a category noun failed 0, on all 6 pieces. Deleting the dated
 * correction note from *What the records name* failed 0. Taking that same guide
 * out of the sitemap failed 0.
 *
 * So a check in this file may never read its expectation off the piece. It names
 * the words, and it fails when they go.
 */

/**
 * Every piece we have published, by address, typed out.
 *
 * The registry list below is what makes this safe to type: a piece added to the
 * site and not to this file fails immediately, so a new piece cannot slip past the
 * checks underneath without somebody deciding what it must carry.
 */
const PUBLISHED_ADDRESSES = [
  '/read/research/the-money-only-goes-one-way',
  '/read/guides/who-has-to-report-their-money',
  '/read/guides/what-the-records-name',
  '/read/guides/why-2-official-numbers-can-both-be-right',
  '/read/guides/money-spent-without-a-campaigns-say',
  '/read/guides/why-nobody-can-follow-a-dollar',
];

const servedPage = (slug: string): string =>
  renderPageSnapshot(researchPageSnapshot(researchBySlug(slug)!));

describe('the pieces this file speaks for are the pieces we publish', () => {
  it('names every published address, so a new piece cannot skip these checks', () => {
    expect(PUBLISHED_RESEARCH.map((piece) => piecePath(piece)).sort()).toEqual(
      [...PUBLISHED_ADDRESSES].sort(),
    );
  });
});

/**
 * Rule 13, as amended 28 Aug 2026: a cross-member figure computed from records we
 * do NOT hold carries a method box beside its first use, and that box states 4
 * things — where the records came from, named and linked; what was added up;
 * how far the records run; and which counting choice could have moved the answer.
 *
 * *The Money Only Goes One Way*'s $886 million of lobbying spending was that
 * figure, and the box was the whole safeguard while we held no lobbying records.
 * Since 31 Aug 2026 we hold them (#1862), so rule 13's ordinary condition applies
 * too: the figure recomputes from a pinned snapshot, and
 * `scripts/recompute_lobbying_published_figures.py` reproduces $886,298,059.00
 * across 3,056 organisations and this section's 5 largest, to the cent. The box
 * is kept, because what it states is the counting a reader would have to repeat,
 * and these checks keep it whole.
 */
describe('the lobbying total carries the method box that stands in for a recompute', () => {
  const piece = researchBySlug('the-money-only-goes-one-way')!;
  const html = servedPage('the-money-only-goes-one-way');

  /** The section that first states the figure, and so the section the box belongs beside. */
  const section = piece.sections.find(
    (each) => each.heading === 'The number that dwarfs all of it',
  );

  it('states the figure the box exists for', () => {
    expect(html).toContain(
      'Companies and organizations reported spending $886 million lobbying Minnesota government from 2015 through 2025.',
    );
  });

  it('puts the box beside that figure, not somewhere else in the piece', () => {
    expect(section?.methodologyInset?.title).toBe('How we counted the lobbying total');
    expect(html).toContain('How we counted the lobbying total');
  });

  it('says where the records came from, inside the box itself', () => {
    expect(html).toContain(
      'are published at cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/.',
    );
  });

  it('links that same address, so a reader opens it rather than retyping it', () => {
    // Named AND linked are 2 separate requirements met in 2 separate places: the box
    // names the address in its own words, the sources block carries the anchor. The
    // address shipped as unclickable text for 2 hours on 28 Aug 2026 (#1802), so
    // checking only one of the 2 would have called that page compliant.
    expect(html).toContain(
      '<a href="https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/">',
    );
  });

  it('says what was added up, precisely enough to pick the same column', () => {
    expect(html).toContain('from its Total spent column');
  });

  it('says how far the records run, as the source’s own boundary', () => {
    expect(html).toContain('The rows run through the report due 16 March 2026');
  });

  it('says which counting choices could have moved the answer', () => {
    // Two of them, and the box has to name both. The report-year one decides whether
    // "2015 through 2025" is a spending window; the identity one decides the 3,056
    // count and the 5-name table, which is the part a reader quotes. Neither moves
    // the figures, and saying so is what lets a reader check rather than trust.
    expect(html).toContain('Two choices in that counting could have moved these figures');
    expect(html).toContain('A report year is a calendar year of spending rather than of filing');
    expect(html).toContain('no registration number in the file carries 2 filed names');
  });
});

/**
 * Rule 13's third exception: a derived classification of filers publishes its
 * complete method beside its first use, carries the records-through date it was
 * computed on, and is introduced as our term rather than a filing category.
 *
 * "Both-sides PAC" is the one derived classification we have published.
 */
describe('the both-sides PAC label carries its complete method', () => {
  const piece = researchBySlug('the-money-only-goes-one-way')!;
  const html = servedPage('the-money-only-goes-one-way');
  const section = piece.sections.find((each) => each.heading === "Why this isn't a party story");

  it('puts the method beside the label’s first use', () => {
    expect(html).toContain('Those 191 both-sides PACs account for $36.4 million');
    expect(section?.methodologyInset?.title).toBe('How we counted the 191');
    expect(html).toContain('How we counted the 191');
  });

  it('says what counts as giving to both sides, and over what years', () => {
    expect(html).toContain('at least one payment of any size to a DFL');
    expect(html).toContain('at least one to a Republican legislative caucus, across 2015 to 2026');
  });

  it('says which counting choice changes the answer, and what it changes it to', () => {
    expect(html).toContain('The rule changes the answer: identifying organizations by');
    expect(html).toContain('registration number instead gives 187 and $39.8 million');
  });

  it('says the term is ours, not the Board’s', () => {
    expect(html).toContain('is our term, not the Board');
  });

  it('carries the records-through date it was computed on', () => {
    expect(html).toContain('Counted from the download as Alethical loaded it on 12 August 2026');
  });
});

/**
 * Rule 13's second exception, and its publishing order point 8: a piece names, in
 * its own words, the body whose filings it read. Every piece we have published so
 * far reads Minnesota's Campaign Finance Board and nothing else.
 */
describe('every published piece names the body whose filings it read', () => {
  it.each(PUBLISHED_ADDRESSES)('names the Campaign Finance Board on %s', (address) => {
    const slug = address.slice(address.lastIndexOf('/') + 1);
    expect(servedPage(slug)).toContain('Campaign Finance Board');
  });

  it('names the Board in the research piece’s own sources block', () => {
    // Point 8 puts this in the sources block specifically, and the research piece is
    // where rule 13's cross-body condition actually bites: it is the one piece that
    // adds figures up across members.
    expect(servedPage('the-money-only-goes-one-way')).toContain(
      'Minnesota Campaign Finance Board bulk data downloads',
    );
  });

  it('names the lobbying records behind the figure, and the years they cover', () => {
    // Rule 13's publishing order point 11: the masthead's records-through date
    // speaks only for our campaign-finance loaded data, and the lobbying file is a
    // separate yearly filing with its own coverage end, so the sources block is
    // still where those records and their years are named.
    const html = servedPage('the-money-only-goes-one-way');
    expect(html).toContain('CFB lobbying principal expenditure reports, 2015');
    expect(html).toContain(
      'Alethical has kept its own dated copy of the Board’s file since 31 August 2026',
    );
  });

  it('never tells a reader we hold no lobbying records', () => {
    // The claim was true when the piece posted and false from 31 Aug 2026, and it
    // stood in 4 places across 2 published pieces. This is the guard that stops it
    // coming back: a sentence nobody would think to re-check, because it reads as
    // background rather than as a figure.
    for (const slug of ['the-money-only-goes-one-way', 'money-spent-without-a-campaigns-say']) {
      const html = servedPage(slug);
      expect(html).not.toContain('holds no lobbying records');
      expect(html).not.toContain('holds none of these records');
    }
  });
});

/**
 * Rule 13's publishing order point 7a: a correction replaces the wrong figure
 * outright, and a dated note at the top says what moved, so the change is never
 * silent. *What the records name* is the one posted piece carrying one.
 */
describe('a corrected piece keeps the dated note that says what moved', () => {
  const html = servedPage('what-the-records-name');

  it('carries the correction’s own date', () => {
    expect(html).toContain('CORRECTED AUG 27 2026');
  });

  it('says what moved, in the note rather than only in the text', () => {
    expect(html).toContain(
      'Two quotations from the Board\u2019s Political Party Unit Handbook were removed.',
    );
  });
});

/**
 * Rule 13's publishing order point 4: every published piece is visible to search
 * engines from the day it posts, which means a row in the sitemap at its own
 * address. The sitemap's own test walks `indexedResearch()`, so a piece whose flag
 * is turned off drops out of both the sitemap and the check at once.
 */
describe('every published piece has a sitemap row at its own address', () => {
  it('lists all 6 addresses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }),
    );
    let body = '';
    const response = {
      setHeader: () => undefined,
      status: () => response,
      send: (value: string) => {
        body = value;
      },
    };
    await sitemapHandler({ query: { section: 'pages' } }, response);
    vi.unstubAllGlobals();

    for (const address of PUBLISHED_ADDRESSES) {
      expect(body).toContain(`<loc>https://www.alethical.com${address}</loc>`);
    }
  });
});
