// What the Track button knows about the reader's tracked state (#1013, #1021).
//
// The case this file exists for is the FIRST group below: a signed-out visitor must
// never see the checking form OR the outlined "couldn't check" form. They are the
// majority of traffic, the Track button is on every bill card on the site, and the
// two obvious implementations both get it wrong — gating on the query's `isPending`
// pins a spinner on forever (a disabled query stays pending), and gating on
// `isLoading` misses the start of a signed-in reader's gap (a disabled query is not
// fetching). The rest pin the truth table so neither mistake, and no "simplification"
// of the four states back down to two, can creep in later.

import { describe, expect, it } from 'vitest';

import { trackState } from '../trackedState';

const inputs = (over: Partial<Parameters<typeof trackState>[0]> = {}) => ({
  isSignedIn: true,
  hasList: true,
  isError: false,
  isTracked: false,
  ...over,
});

describe('trackState — signed out is never unknown', () => {
  it('is untracked with no list and nothing fetched', () => {
    // The regression that matters most: "+ Track" on the first frame, every card.
    expect(trackState(inputs({ isSignedIn: false, hasList: false }))).toBe('untracked');
  });

  it('is untracked even when the request errored', () => {
    // No spinner and no outlined retry button for an anonymous visitor, ever.
    expect(trackState(inputs({ isSignedIn: false, hasList: false, isError: true }))).toBe(
      'untracked',
    );
  });

  it('is untracked even if a stale list somehow says otherwise', () => {
    expect(trackState(inputs({ isSignedIn: false, isTracked: true }))).toBe('untracked');
  });
});

describe('trackState — signed in', () => {
  it('reports tracked and untracked once the list has arrived', () => {
    expect(trackState(inputs({ isTracked: true }))).toBe('tracked');
    expect(trackState(inputs({ isTracked: false }))).toBe('untracked');
  });

  it('is checking while the list has not arrived', () => {
    // Covers both halves of the gap: before the stored session is read back (the
    // query is still disabled, so no flag calls it "loading") and while it is in
    // flight.
    expect(trackState(inputs({ hasList: false }))).toBe('checking');
  });

  it('is unavailable when the request failed with nothing to fall back on', () => {
    // Deliberately NOT 'untracked'. Pressing "+ Track" on a bill they already track
    // would re-save instead of remove, and the label would assert what we never
    // checked. The outlined form says nothing and offers a retry.
    expect(trackState(inputs({ hasList: false, isError: true }))).toBe('unavailable');
  });

  it('prefers a list it already has over a later error', () => {
    // A background refetch can fail while the reader's real watchlist is on screen.
    // That data is not wrong, so the button keeps its honest label.
    expect(trackState(inputs({ isError: true, isTracked: true }))).toBe('tracked');
    expect(trackState(inputs({ isError: true, isTracked: false }))).toBe('untracked');
  });
});
