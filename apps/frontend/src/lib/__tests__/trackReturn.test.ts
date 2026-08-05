import { describe, expect, it } from 'vitest';

import { shouldAnnounceTrack, trackReturnAction } from '../trackReturn';

const ON_RETURN = {
  requestedOnReturn: true,
  signedIn: true,
  billLoaded: true,
  trackedListLoading: false,
  alreadyTracked: false,
  alreadyFired: false,
};

describe('coming back from sign-in', () => {
  it('saves the bill the person asked to track', () => {
    expect(trackReturnAction(ON_RETURN)).toBe('track');
  });

  it('waits until it knows what the person already tracks', () => {
    expect(trackReturnAction({ ...ON_RETURN, trackedListLoading: true })).toBe('wait');
  });

  it('waits until the bill itself has arrived', () => {
    expect(trackReturnAction({ ...ON_RETURN, billLoaded: false })).toBe('wait');
  });

  it('waits while the sign-in session is still being read back', () => {
    expect(trackReturnAction({ ...ON_RETURN, signedIn: false })).toBe('wait');
  });

  it('saves nothing when the bill is already tracked, and tidies the address', () => {
    expect(trackReturnAction({ ...ON_RETURN, alreadyTracked: true })).toBe('clear');
  });

  it('does not save twice if the screen re-renders', () => {
    expect(trackReturnAction({ ...ON_RETURN, alreadyFired: true })).toBe('clear');
  });
});

describe('an ordinary visit, with no sign-in behind it', () => {
  it('does nothing at all', () => {
    expect(trackReturnAction({ ...ON_RETURN, requestedOnReturn: false })).toBe('wait');
  });

  it('does nothing even once everything else is ready', () => {
    expect(
      trackReturnAction({
        requestedOnReturn: false,
        signedIn: true,
        billLoaded: true,
        trackedListLoading: false,
        alreadyTracked: false,
        alreadyFired: false,
      }),
    ).toBe('wait');
  });
});

// The whole value of this message is that it is rare. #1015: show it only on a
// return that actually saved the bill, never on an ordinary Track tap, where the
// button's own label flips under the person's finger.
describe('when the "Now tracking" message shows', () => {
  it('shows on a return that saved the bill', () => {
    expect(shouldAnnounceTrack(trackReturnAction(ON_RETURN))).toBe(true);
  });

  it('stays quiet when the bill was already tracked', () => {
    expect(shouldAnnounceTrack(trackReturnAction({ ...ON_RETURN, alreadyTracked: true }))).toBe(
      false,
    );
  });

  it('stays quiet on an ordinary visit, which is what a manual tap is', () => {
    expect(shouldAnnounceTrack(trackReturnAction({ ...ON_RETURN, requestedOnReturn: false }))).toBe(
      false,
    );
  });

  it('stays quiet while anything is still loading, so it cannot fire early', () => {
    expect(shouldAnnounceTrack(trackReturnAction({ ...ON_RETURN, trackedListLoading: true }))).toBe(
      false,
    );
    expect(shouldAnnounceTrack(trackReturnAction({ ...ON_RETURN, billLoaded: false }))).toBe(false);
  });

  it('stays quiet on a repeat render, so it cannot show twice', () => {
    expect(shouldAnnounceTrack(trackReturnAction({ ...ON_RETURN, alreadyFired: true }))).toBe(
      false,
    );
  });
});
