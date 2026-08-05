// Whether the Track button knows the reader's tracked state (#1013).
//
// The case this file exists for is the FIRST one below: a signed-out visitor must
// never see the "checking" form. They are the majority of traffic, the Track button
// is on every bill card on the site, and the two obvious implementations both get
// this wrong — gating on the query's `isPending` pins a spinner on forever (a
// disabled query stays pending), and gating on `isLoading` misses the start of a
// signed-in reader's gap (a disabled query is not fetching). The other cases pin the
// rest of the truth table so neither mistake can creep back in as a "simplification".

import { describe, expect, it } from 'vitest';

import { isTrackedStateUnknown } from '../trackedState';

describe('isTrackedStateUnknown', () => {
  it('is false for a signed-out visitor, even with no list and nothing fetched', () => {
    // The regression that matters. A signed-out reader tracks nothing, so the state
    // is known, not unknown: "+ Track" must show immediately on every card.
    expect(isTrackedStateUnknown({ isSignedIn: false, hasList: false, isError: false })).toBe(
      false,
    );
  });

  it('stays false for a signed-out visitor whose earlier request errored', () => {
    expect(isTrackedStateUnknown({ isSignedIn: false, hasList: false, isError: true })).toBe(false);
  });

  it('is true for a signed-in reader whose list has not arrived', () => {
    // Covers both halves of a signed-in gap: before the stored session is read back
    // (the query is still disabled, so it is not "loading" by any flag) and while the
    // request is genuinely in flight.
    expect(isTrackedStateUnknown({ isSignedIn: true, hasList: false, isError: false })).toBe(true);
  });

  it('is false once the list has arrived', () => {
    expect(isTrackedStateUnknown({ isSignedIn: true, hasList: true, isError: false })).toBe(false);
  });

  it('is false when the request failed, so the button stays usable', () => {
    // Unknown-and-unresolvable is not the same as unknown. Holding the checking form
    // here would leave the button permanently unpressable with no way out; falling
    // back lets the reader press it, and the press repairs the label.
    expect(isTrackedStateUnknown({ isSignedIn: true, hasList: false, isError: true })).toBe(false);
  });

  it('prefers a list it already has over a later error', () => {
    // A refetch can fail while cached data is still on screen. That data is the
    // reader's real watchlist, so the state is known and the label is correct.
    expect(isTrackedStateUnknown({ isSignedIn: true, hasList: true, isError: true })).toBe(false);
  });
});
