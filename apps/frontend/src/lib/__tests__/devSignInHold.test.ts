import { describe, expect, it } from 'vitest';

import { HOLD_SIGN_IN_PARAM, signInHoldRequested } from '../devSignInHold';

// The hold stops the sign-in dialog on "Connecting" so the state can be looked at.
// The half worth pinning is the gate: a production bundle must refuse it however the
// URL is written, because the only thing standing between this and a real sign-in
// flow that never starts is one boolean.

describe('the production gate', () => {
  it('refuses the hold in a production build, whatever the URL asks for', () => {
    expect(signInHoldRequested(`?${HOLD_SIGN_IN_PARAM}=1`, false)).toBe(false);
    expect(signInHoldRequested(`?a=b&${HOLD_SIGN_IN_PARAM}=1&c=d`, false)).toBe(false);
  });

  it('allows it in a development build when the URL asks', () => {
    expect(signInHoldRequested(`?${HOLD_SIGN_IN_PARAM}=1`, true)).toBe(true);
    expect(signInHoldRequested(`?returnTo=/bills&${HOLD_SIGN_IN_PARAM}=1`, true)).toBe(true);
  });

  it('leaves an ordinary development URL alone', () => {
    expect(signInHoldRequested('', true)).toBe(false);
    expect(signInHoldRequested('?chamber=House', true)).toBe(false);
  });

  it('takes only an exact 1 — no truthy-looking value opens it by accident', () => {
    expect(signInHoldRequested(`?${HOLD_SIGN_IN_PARAM}=true`, true)).toBe(false);
    expect(signInHoldRequested(`?${HOLD_SIGN_IN_PARAM}=`, true)).toBe(false);
    expect(signInHoldRequested(`?${HOLD_SIGN_IN_PARAM}`, true)).toBe(false);
  });
});
