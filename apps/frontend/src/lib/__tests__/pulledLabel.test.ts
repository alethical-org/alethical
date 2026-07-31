// The source line's date segment (#861).
//
// The rule: "Updated {date}" is a claim about how current OUR copy is, so it may
// only ever be built from the date we last pulled the bill. Two other dates sit
// within reach and each says something different — the Legislature's last action
// on the bill (`updatedAt`, already shown in the meta rows as "Latest action") and
// the corpus-wide last-ingestion time. Reaching for either is the bug these pin.

import { describe, expect, it } from 'vitest';

import { pulledLabel } from '../billDetail';

describe('pulledLabel', () => {
  it('reads the date we pulled the bill', () => {
    // HF 719's real production values: pulled Jul 14 2026, last acted on May 17 2026.
    expect(pulledLabel({ lastPulledAt: '2026-07-14T19:38:30.399280+00:00' })).toBe(
      'Updated Jul 14, 2026',
    );
  });

  it('never falls back to the legislative action date', () => {
    // The bill carries a last-action date and no pull date. The segment must go —
    // reaching for the action date here is the #861 bug, which labelled HF 719's
    // May 17 action "Updated May 17" as though we had checked the bill that day.
    // Passed as a wider object on purpose: a fallback would find `updatedAt`, so
    // omitting it would let the regression through.
    const bill = { lastPulledAt: undefined, updatedAt: '2026-05-17T00:00:00+00:00' };
    expect(pulledLabel(bill)).toBe('');
  });

  it('drops the segment rather than printing a date that will not parse', () => {
    // formatNiceDate passes an unparseable string through unchanged, so without the
    // guard the foot of the page reads "Updated Unknown".
    expect(pulledLabel({ lastPulledAt: '' })).toBe('');
    expect(pulledLabel({ lastPulledAt: 'Unknown' })).toBe('');
    expect(pulledLabel({ lastPulledAt: 'not a date' })).toBe('');
  });
});
