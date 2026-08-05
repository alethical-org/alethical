// Whether the Track button honestly knows the reader's tracked state yet (#1013).
//
// A pure function rather than a line inside the hook, because the case that matters
// most cannot be checked any other way here: the frontend's test runner is
// pure-logic only (no component or browser tests, #751), and the case worth pinning
// is a *signed-out* visitor never seeing the checking form. That is the majority of
// traffic on every card on the site, and getting it wrong ships a permanent spinner
// where the Track button belongs.
//
// The condition is deliberately NOT "the query is loading". Two separate
// measurements, from two sessions, bracket why no single React Query flag works on
// the installed @tanstack/react-query 5.100.9:
//
//   * `useTrackedBills` is `enabled: Boolean(userId && accessToken)`, and a DISABLED
//     query reports `isPending: true` FOREVER. Gate on isPending and every
//     signed-out visitor gets a spinner that never resolves.
//   * That same disabled query reports `isLoading: false`, because v5 derives
//     `isLoading = isPending && isFetching` and a disabled query is not fetching. So
//     isLoading is also false during the first part of a *signed-in* reader's gap,
//     before the stored session has been read back and the query is enabled at all.
//
// Neither flag alone is right, so this asks the two questions that actually decide
// it: are we signed in, and has the list arrived?

export interface TrackedStateInputs {
  /** Whether a session exists at all. A signed-out reader tracks nothing. */
  isSignedIn: boolean;
  /** Whether the watchlist response has arrived (the query has data). */
  hasList: boolean;
  /** Whether the watchlist request failed. */
  isError: boolean;
}

export function isTrackedStateUnknown({
  isSignedIn,
  hasList,
  isError,
}: TrackedStateInputs): boolean {
  // Signed out is not unknown -- it is known to be nothing. "+ Track" is the honest
  // and correct button, and it must appear immediately.
  if (!isSignedIn) return false;
  // A failed request is unknown and UNRESOLVABLE, which is a different thing from
  // unknown. Holding the checking form would leave the button permanently
  // unpressable with nothing the reader can do about it, so we fall back to the
  // known-state rendering instead. That is not a wrong assertion left standing:
  // pressing Track upserts, the mutation invalidates this query, and the refetch
  // repairs the label -- so the button's own action IS the retry, which is why no
  // separate retry affordance is needed (#1013, and the request is measured at
  // ~144ms in production, so this path is a fault and not the common case).
  if (isError) return false;
  return !hasList;
}
