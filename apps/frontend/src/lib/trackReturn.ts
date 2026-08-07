// Backward compatibility for old `/bills/{id}?track=1` sign-in return links.
// New Track requests return to their exact page and are completed by
// SignInModalProvider. The bill screens keep accepting these already-issued URLs.

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
