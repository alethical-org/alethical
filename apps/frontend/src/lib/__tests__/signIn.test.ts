import { describe, expect, it } from 'vitest';

import {
  SIGN_IN_BUTTON_LABEL,
  SIGN_IN_ERROR_MESSAGES,
  SIGN_IN_INTENTS,
  SIGN_IN_RETRY_LABEL,
  SignInIntent,
  authErrorReturnDecision,
  createSignInAttemptGate,
  initialSignInState,
  parseAuthError,
  signInButtonLabel,
  signInCopy,
  dedicatedSignInOutcome,
  signInErrorKind,
  signInReducer,
  urlWithoutAuthError,
} from '../signIn';

describe('serious account outcomes', () => {
  it('routes only a deactivated result to a dedicated screen', () => {
    // The match-failure screen was removed in rev 15 as verified unreachable
    // (#1533); an unverified Google return is a banner, not a dead end.
    expect(dedicatedSignInOutcome('deactivated')).toBe('deactivated');
    expect(dedicatedSignInOutcome('unverified-google')).toBeNull();
    expect(dedicatedSignInOutcome('request-failure')).toBeNull();
    expect(dedicatedSignInOutcome('bad-credentials')).toBeNull();
  });
});

const ALL_INTENTS = Object.keys(SIGN_IN_INTENTS) as SignInIntent[];

function openedOn(intent: SignInIntent, billCode?: string) {
  return signInReducer(initialSignInState, {
    type: 'open',
    request: { intent, billCode, returnTo: '/bills/HF4138?track=1' },
  });
}

describe('intent → copy', () => {
  it('has exactly the two reasons sign-in can open', () => {
    expect(ALL_INTENTS.sort()).toEqual(['nav', 'track']);
  });

  it('uses the Alethical mark for plain sign-in and a bell for Track', () => {
    expect(signInCopy('nav').icon).toBe('brand');
    expect(signInCopy('track').icon).toBe('bell');
  });

  it('uses the shorter nav subcopy', () => {
    expect(signInCopy('nav').subcopy).toBe('Bills you track are saved to your account.');
  });

  it('uses the approved Track-intent copy', () => {
    const { headline, subcopy } = signInCopy('track', 'HF 4138');
    expect(headline).toBe('Sign in to track this bill');
    expect(subcopy).toBe('Bills you track are saved to your account.');
  });

  it('uses the same Track-intent copy when only the id is known', () => {
    expect(signInCopy('track').subcopy).toBe(signInCopy('track', 'HF 4138').subcopy);
  });

  it('gives every intent a headline and a subcopy', () => {
    for (const intent of ALL_INTENTS) {
      expect(signInCopy(intent).headline.length).toBeGreaterThan(0);
      expect(signInCopy(intent).subcopy.length).toBeGreaterThan(0);
    }
  });
});

describe('shared Google failure copy', () => {
  it('uses the same connection failure as every other sign-in request', () => {
    expect(SIGN_IN_ERROR_MESSAGES.failed).toBe(
      'We couldn’t complete that request. Check your connection and try again.',
    );
  });
});

// grounded-answers.md rule 6: copy may only claim what the product does. Sending
// alerts is not built (#36) — the server records that one is due and sends
// nothing — so no sign-in copy may imply a message will arrive.
describe('no sign-in copy promises a notification', () => {
  const PROMISES = [
    'email',
    'e-mail',
    'notif',
    'alert',
    'notify',
    'push',
    'text you',
    'remind',
    'inbox',
    'subscribe',
  ];
  // An error message may NAME an email (the unverified-Google banner must, in
  // arrival-neutral wording, #1533) but may never claim one was sent.
  const SEND_CLAIMS = ['we’ve sent', 'we sent', 'is on the way', 'we’ll send', 'we will send'];

  it('says nothing about email or alerts in the track copy', () => {
    const { headline, subcopy } = signInCopy('track', 'HF 4138');
    const text = `${headline} ${subcopy}`.toLowerCase();
    for (const promise of PROMISES) {
      expect(text).not.toContain(promise);
    }
  });

  it('says nothing about email or alerts in any intent or button label', () => {
    const strings = [
      ...ALL_INTENTS.flatMap((intent) => {
        const { headline, subcopy } = signInCopy(intent, 'HF 4138');
        return [headline, subcopy];
      }),
      SIGN_IN_BUTTON_LABEL,
      SIGN_IN_RETRY_LABEL,
    ];
    for (const value of strings) {
      for (const promise of PROMISES) {
        expect(value.toLowerCase()).not.toContain(promise);
      }
    }
  });

  it('never claims a send in any error message — arrival-neutral only', () => {
    for (const value of Object.values(SIGN_IN_ERROR_MESSAGES)) {
      for (const claim of SEND_CLAIMS) {
        expect(value.toLowerCase()).not.toContain(claim);
      }
    }
    expect(SIGN_IN_ERROR_MESSAGES['unverified-google']).toBe(
      'Sign-in couldn’t finish because the email address needs confirmation. If a confirmation email arrives, open the newest one.',
    );
  });

  it('states the payoff we can actually deliver: a saved list', () => {
    expect(signInCopy('track', 'HF 4138').subcopy).toBe(
      'Bills you track are saved to your account.',
    );
  });
});

describe('dialog state machine', () => {
  it('opens on the requested intent, carrying the bill and the return target', () => {
    const state = openedOn('track', 'HF 4138');
    expect(state).toMatchObject({
      open: true,
      intent: 'track',
      billCode: 'HF 4138',
      returnTo: '/bills/HF4138?track=1',
      status: 'idle',
      errorKind: null,
    });
  });

  it('goes to connecting when the Google button is pressed', () => {
    const state = signInReducer(openedOn('nav'), { type: 'connect' });
    expect(state.status).toBe('connecting');
  });

  it('ignores a connect when no dialog is on screen', () => {
    expect(signInReducer(initialSignInState, { type: 'connect' })).toBe(initialSignInState);
  });

  it('ignores a failure when no dialog is on screen', () => {
    expect(signInReducer(initialSignInState, { type: 'fail', kind: 'failed' })).toBe(
      initialSignInState,
    );
  });

  it('shows the error without losing why the person was signing in', () => {
    const connecting = signInReducer(openedOn('track', 'HF 4138'), { type: 'connect' });
    const failed = signInReducer(connecting, { type: 'fail', kind: 'cancelled' });
    expect(failed).toMatchObject({
      open: true,
      intent: 'track',
      billCode: 'HF 4138',
      status: 'error',
      errorKind: 'cancelled',
    });
  });

  it('clears the error when Try again starts the flow over', () => {
    const failed = signInReducer(signInReducer(openedOn('nav'), { type: 'connect' }), {
      type: 'fail',
      kind: 'failed',
    });
    const retried = signInReducer(failed, { type: 'connect' });
    expect(retried.status).toBe('connecting');
    expect(retried.errorKind).toBeNull();
  });

  it('reopens on the way back from Google already knowing what failed', () => {
    const state = signInReducer(initialSignInState, {
      type: 'reopenWithError',
      request: { intent: 'track', billCode: 'HF 4138', returnTo: '/bills/HF4138?track=1' },
      kind: 'cancelled',
    });
    expect(state).toMatchObject({
      open: true,
      intent: 'track',
      billCode: 'HF 4138',
      status: 'error',
      errorKind: 'cancelled',
    });
  });

  it('starts a fresh ask with no error showing, even straight after a failed one', () => {
    const failed = signInReducer(signInReducer(openedOn('track', 'HF 4138'), { type: 'connect' }), {
      type: 'fail',
      kind: 'failed',
    });
    const reopened = signInReducer(failed, { type: 'open', request: { intent: 'nav' } });
    expect(reopened.status).toBe('idle');
    expect(reopened.errorKind).toBeNull();
    expect(reopened.billCode).toBeUndefined();
  });

  it('leaves nothing behind when it closes, so the next open starts clean', () => {
    const failed = signInReducer(signInReducer(openedOn('track', 'HF 4138'), { type: 'connect' }), {
      type: 'fail',
      kind: 'failed',
    });
    expect(signInReducer(failed, { type: 'close' })).toEqual(initialSignInState);
  });

  it('labels the button Try again only after a failure', () => {
    expect(signInButtonLabel('idle')).toBe(SIGN_IN_BUTTON_LABEL);
    expect(signInButtonLabel('connecting')).toBe(SIGN_IN_BUTTON_LABEL);
    expect(signInButtonLabel('error')).toBe(SIGN_IN_RETRY_LABEL);
  });
});

describe('reading a failure off the return URL', () => {
  it('waits for the saved session before deciding whether a return error is real', () => {
    expect(authErrorReturnDecision(true, false)).toBe('wait-for-session');
  });

  it('ignores an old return error when the reader already has a valid session', () => {
    expect(authErrorReturnDecision(false, true)).toBe('keep-success');
  });

  it('shows a return error when the session check finds no signed-in reader', () => {
    expect(authErrorReturnDecision(false, false)).toBe('show-error');
  });

  it('treats backing out of Google as cancelled, everything else as a failure', () => {
    expect(signInErrorKind('access_denied')).toBe('cancelled');
    expect(signInErrorKind('access_denied', 'provider_access_denied')).toBe('cancelled');
    expect(signInErrorKind('server_error')).toBe('failed');
    expect(signInErrorKind(null)).toBe('failed');
  });

  it('tells an unverified Google email apart from a cancel behind the same error param', () => {
    // Supabase reuses error=access_denied for callback failures and puts the
    // real reason in error_code — reading only the first param made this
    // result close the dialog silently (#1533).
    expect(signInErrorKind('access_denied', 'provider_email_needs_verification')).toBe(
      'unverified-google',
    );
    expect(signInErrorKind('provider_email_needs_verification')).toBe('unverified-google');
    expect(signInErrorKind('access_denied', 'signup_disabled')).toBe('failed');
  });

  it('finds the error in the query string', () => {
    expect(parseAuthError('?error=access_denied&error_description=User+said+no', '')).toEqual({
      code: 'access_denied',
      errorCode: null,
      description: 'User said no',
    });
  });

  it('finds the error in the hash, which is where the implicit flow puts it', () => {
    expect(parseAuthError('', '#error=server_error&error_description=Boom')).toEqual({
      code: 'server_error',
      errorCode: null,
      description: 'Boom',
    });
  });

  it('surfaces the specific error_code beside the generic error param', () => {
    expect(
      parseAuthError('?error=access_denied&error_code=provider_email_needs_verification', ''),
    ).toEqual({
      code: 'access_denied',
      errorCode: 'provider_email_needs_verification',
      description: null,
    });
  });

  it('reads error_code when there is no plain error param', () => {
    expect(parseAuthError('?error_code=otp_expired', '')?.code).toBe('otp_expired');
  });

  it('reports nothing on a clean return', () => {
    expect(parseAuthError('?track=1', '#access_token=abc')).toBeNull();
  });

  it('strips the failure params from both the query and the hash, keeping the rest', () => {
    expect(
      urlWithoutAuthError(
        'https://alethical.com/bills/HF4138?track=1&error=access_denied&error_description=nope#error_code=400&keep=yes',
      ),
    ).toBe('/bills/HF4138?track=1#keep=yes');
  });

  it('drops an empty hash rather than leaving a bare #', () => {
    expect(urlWithoutAuthError('https://alethical.com/tracked#error=access_denied')).toBe(
      '/tracked',
    );
  });
});

describe('starting Google sign-in once', () => {
  it('accepts the first press and blocks a second press before the screen redraws', () => {
    const gate = createSignInAttemptGate();

    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
  });

  it('accepts a fresh press after a failed attempt is reset', () => {
    const gate = createSignInAttemptGate();

    expect(gate.begin()).toBe(true);
    gate.reset();
    expect(gate.begin()).toBe(true);
  });
});
