/**
 * The homepage money card's two load-bearing sentences, pinned.
 *
 * Neither is a style preference, and both are easy to "improve" back into a
 * claim we cannot support, which is why they are asserted rather than left to
 * review:
 *
 * - The body line may say figures are READ FROM the filings. It may not say each
 *   entry is TIED TO the filing it came from. Minnesota's itemized-contributions
 *   download carries no report reference to join on, matching by date names a
 *   different set of donors than any single report does, and the Board's report
 *   documents are fetched by form submission rather than by address — so the
 *   older wording promised a link that cannot be built at any point on the
 *   campaign-money roadmap.
 * - The count line must name the register it counts. 1,603 is campaign filers
 *   alone; lobbying has its own register and is not in the number, so a bare
 *   "campaigns, parties, and funds" under a sentence promising campaign AND
 *   lobbying records reads as the size of both.
 */

import { describe, expect, it } from 'vitest';

import {
  MONEY_PROMO_BODY,
  MONEY_PROMO_CAVEAT,
  MONEY_PROMO_COUNT_UNIT,
  MONEY_PROMO_CTA,
  MONEY_PROMO_HEADING,
} from '../../../lib/homepage';

describe('the money card never re-promises a per-row link to a filing', () => {
  it('says the figures are read from the filings', () => {
    expect(MONEY_PROMO_BODY).toBe(
      'Minnesota’s campaign and lobbying records — every figure read from the filings sent to the state, never a total we assembled.',
    );
  });

  it.each([
    'tied to the filing',
    'linked to the filing',
    'traced to the filing',
    'each entry tied',
  ])('does not claim entries are %s', (banned) => {
    expect(MONEY_PROMO_BODY.toLowerCase()).not.toContain(banned);
  });
});

describe('the count line names which register it counts', () => {
  it('says registered, so the number cannot read as covering lobbying too', () => {
    expect(MONEY_PROMO_COUNT_UNIT).toBe('registered campaigns, parties, and funds');
  });

  it('never claims to count lobbyists, which are a register we do not hold', () => {
    expect(MONEY_PROMO_COUNT_UNIT.toLowerCase()).not.toContain('lobby');
  });
});

describe('the rest of the card', () => {
  it('keeps the under-construction caveat, which the destination alone cannot carry', () => {
    // The reader decides whether to click here; the money landing's own notice
    // only reaches them after they already have.
    expect(MONEY_PROMO_CAVEAT).toBe('Parts of this are still being built.');
  });

  it('keeps the heading and the call to action verbatim', () => {
    expect(MONEY_PROMO_HEADING).toBe('Follow the money');
    expect(MONEY_PROMO_CTA).toBe('Search the money records');
  });
});
