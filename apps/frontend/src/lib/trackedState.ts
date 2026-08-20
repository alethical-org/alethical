// What the Track button honestly knows about this reader's tracked state (#1013, #1021).
//
// FOUR states, and the button has a distinct form for each, because three of them are
// claims and one of them must not be:
//
//   tracked / untracked → filled black, labelled. We know, so we say so.
//   checking            → filled black, dimmed, spinner, no label, unpressable.
//   unavailable         → the same box OUTLINED, refresh glyph, no label, pressable.
//
// Derived here rather than in each surface. Five places render this button, and a
// four-way condition re-worked out five times is how one of them ends up wrong.
//
// The case worth pinning hardest is SIGNED OUT, and it is pinned by a test because
// the frontend's runner is pure-logic only (no component or browser tests, #751).
// A signed-out visitor is the majority of traffic on every card on the site, and
// their state is NOT unknown — they track nothing, so "+ Track" is correct and
// honest, and neither the checking nor the unavailable form may ever appear for
// them. Design confirmed that explicitly and asked for it to be explicit here:
// neither form is a general loading or error state for this control.
//
// Two measurements, from two sessions, bracket why no single React Query flag can
// stand in for this on the installed @tanstack/react-query 5.100.9:
//
//   * `useTrackedBills` is `enabled: Boolean(userId && accessToken)`, and a DISABLED
//     query reports `isPending: true` FOREVER. Gate on isPending and every
//     signed-out visitor gets a spinner that never resolves.
//   * That same disabled query reports `isLoading: false`, because v5 derives
//     `isLoading = isPending && isFetching` and a disabled query is not fetching. So
//     isLoading also misses the first part of a signed-in reader's gap, before the
//     stored session has been read back and the query is enabled at all.
//
// So this asks the questions that actually decide it: signed in, has the list
// arrived, and did it fail.

export type TrackState = 'tracked' | 'untracked' | 'checking' | 'unavailable';

export interface TrackStateInputs {
  /** Whether a session exists at all. A signed-out reader tracks nothing. */
  isSignedIn: boolean;
  /** Whether the watchlist response has arrived (the query has data). */
  hasList: boolean;
  /** Whether the watchlist request failed. */
  isError: boolean;
  /** Whether this bill is on the watchlist. Meaningful only once it has arrived. */
  isTracked: boolean;
}

export function trackState({
  isSignedIn,
  hasList,
  isError,
  isTracked,
}: TrackStateInputs): TrackState {
  // Signed out is not unknown -- it is known to be nothing, and it must resolve on
  // the first frame with no spinner and no outline.
  if (!isSignedIn) return 'untracked';
  // A list we already have wins over a later failure: a refetch can fail while the
  // reader's real watchlist is still on screen, and that data is not wrong.
  if (hasList) return isTracked ? 'tracked' : 'untracked';
  // Failed with nothing to fall back on. This is its own state because BOTH of the
  // obvious shortcuts are wrong, and they are wrong for opposite reasons — worth
  // recording both, because each one looks like a simplification from the other side:
  //
  //   * Holding 'checking' leaves a DEAD CONTROL. `useTrackedBills` is `retry: false`,
  //     so one blip is permanent until something else refetches; the reader would be
  //     left with a button they can never press and no way to recover.
  //   * Falling back to 'untracked' leaves a FALSE CLAIM. Pressing "+ Track" on a bill
  //     they already track re-saves instead of removing — and even once the press is
  //     made safe by the refetch, the label still states something about the reader's
  //     own list that we never got. A safe action does not make an unearned claim
  //     honest (#1021, Design's reason for rejecting the fallback).
  //
  // So the answer is a different form, not either of these: outlined, wordless,
  // pressable. It asserts nothing and it recovers the whole page in one press.
  if (isError) return 'unavailable';
  return 'checking';
}

/**
 * The number to show beside the account menu's Tracked Bills row, or `null` when
 * there is no number we may show (#1698). Same honesty as `trackState` above,
 * applied to a count instead of a button:
 *
 *   a loaded list of 3  -> 3
 *   a loaded empty list -> null. NEVER a printed 0 -- the row's label alone says
 *                          nothing, which is right, and "0" reads as a claim.
 *   no list yet         -> null. `undefined` covers both a request still in
 *                          flight and one that failed, and neither is a count.
 *
 * A signed-out reader never sees this row at all, so there is no case for them.
 */
export function trackedBillsCount(listLength: number | undefined): number | null {
  if (typeof listLength !== 'number' || listLength <= 0) {
    return null;
  }
  return listLength;
}
