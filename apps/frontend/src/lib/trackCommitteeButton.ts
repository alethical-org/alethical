// The words and the one state rule of the Track control on a committee's money
// page (#1943). React-free so `__tests__/trackCommitteeButton.test.ts` pins them.
//
// The control is the bill Track button's twin: one button, `aria-pressed` false
// then true, pressing again unfollows. It keeps the bill control's own colours
// and sizes (billTrackButtonAppearance.ts), so a committee control never runs
// ahead of the bill one and changes with it.

/** The label in each known state. Same 2 words as the bill control. */
export const TRACK_COMMITTEE_LABEL = 'Track';
export const TRACKED_COMMITTEE_LABEL = 'Tracked';

/** The one new sentence this control adds: under the followed state, where the
 *  bookmark now lives, said once. The last 2 words are the link to `/tracked`.
 *  No dot: a one-line note under a control is a standalone line (copy rule C). */
export const ON_YOUR_TRACKED_LIST = 'On your tracked list';
export const ON_YOUR_TRACKED_LIST_LINK = 'tracked list';
export const ON_YOUR_TRACKED_LIST_LEAD = 'On your ';

export const CHECKING_COMMITTEE_LABEL = 'Checking whether you follow this committee';
export const RECHECK_COMMITTEE_LABEL =
  'Couldn’t check whether you follow this committee. Press to check again.';
export const RETRY_COMMITTEE_WRITE_LABEL = 'Couldn’t save your Track change. Press to try again.';

export type TrackCommitteeState = 'hidden' | 'checking' | 'unavailable' | 'tracked' | 'untracked';

/**
 * Which form the control takes. Signed out is `hidden`: following a committee
 * while signed out is deliberately not built, so the page draws no control at all
 * rather than one that opens a sign-in flow nobody has designed. The other 4 mirror
 * `lib/trackedState.ts`: a list we hold wins over a later failure, a failure with
 * nothing to fall back on is its own wordless form, and until the list arrives the
 * control claims nothing.
 */
export function trackCommitteeState({
  isSignedIn,
  hasList,
  isError,
  writeFailed,
  isTracked,
}: {
  isSignedIn: boolean;
  hasList: boolean;
  isError: boolean;
  writeFailed: boolean;
  isTracked: boolean;
}): TrackCommitteeState {
  if (!isSignedIn) return 'hidden';
  if (writeFailed) return 'unavailable';
  if (hasList) return isTracked ? 'tracked' : 'untracked';
  if (isError) return 'unavailable';
  return 'checking';
}

export function trackCommitteeToggleProps(tracked: boolean) {
  return {
    'aria-pressed': tracked,
    accessibilityLabel: 'Track this committee',
  } as const;
}
