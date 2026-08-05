// What to do when someone lands back on a bill after signing in to track it.
//
// Signing in to track sends you to `/bills/{id}?track=1`, and the bill screen
// finishes the job on arrival (grounded-answers.md rule 5, and the sign-in flow
// in docs/mockups/sign-in). Both bill screens carried an identical copy of this
// decision inline; it lives here instead so there is one truth and a test can
// read it. The screens still own the effect, because only they have the route.

export type TrackReturnAction =
  /** Not enough is known yet. Do nothing and wait for the next render. */
  | 'wait'
  /** Save the bill, then take `?track=1` out of the address. */
  | 'track'
  /** Nothing to save. Just take `?track=1` out of the address. */
  | 'clear';

export function trackReturnAction(input: {
  /** `?track=1` is on the address, so this is a return from sign-in. */
  requestedOnReturn: boolean;
  signedIn: boolean;
  /** The bill itself has arrived. */
  billLoaded: boolean;
  /** The list of bills this person tracks has not arrived yet. */
  trackedListLoading: boolean;
  /** This bill is already on that list. */
  alreadyTracked: boolean;
  /** This return already saved it once, so a re-render must not repeat it. */
  alreadyFired: boolean;
}): TrackReturnAction {
  const { requestedOnReturn, signedIn, billLoaded, trackedListLoading } = input;
  if (!requestedOnReturn || !signedIn || !billLoaded || trackedListLoading) {
    return 'wait';
  }
  if (input.alreadyFired || input.alreadyTracked) {
    return 'clear';
  }
  return 'track';
}

/**
 * Whether to show the "Now tracking {code}." confirmation.
 *
 * Only on a return that actually saved the bill. Never on an ordinary Track tap:
 * there the button's own label flips under the person's finger, so a message
 * beside it is noise (decided Aug 5 2026, issue #1015).
 */
export function shouldAnnounceTrack(action: TrackReturnAction): boolean {
  return action === 'track';
}
