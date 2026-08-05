import { describe, expect, it } from 'vitest';

import {
  SIGN_IN_BUTTON_LABEL,
  SIGN_IN_ERROR_MESSAGES,
  SIGN_IN_INTENTS,
  SIGN_IN_RETRY_LABEL,
  SignInIntent,
  canOpenSignIn,
  initialSignInState,
  parseAuthError,
  signInButtonLabel,
  signInCopy,
  signInErrorKind,
  signInReducer,
  urlWithoutAuthError,
} from '../signIn';

const ALL_INTENTS = Object.keys(SIGN_IN_INTENTS) as SignInIntent[];

function openedOn(intent: SignInIntent, billCode?: string) {
  return signInReducer(initialSignInState, {
    type: 'open',
    request: { intent, billCode, returnTo: '/bills/HF4138?track=1' },
  });
}

describe('intent → copy', () => {
  it('names the bill in the track subcopy when the caller knows it', () => {
    const { headline, subcopy } = signInCopy('track', 'HF 4138');
    expect(headline).toBe('Sign in to track this bill');
    expect(subcopy).toContain('HF 4138');
  });

  it('falls back to "this bill" when only the id is known', () => {
    expect(signInCopy('track').subcopy).toContain('this bill');
    expect(signInCopy('track').subcopy).not.toContain('undefined');
  });

  it('gives the nav button and the account card the same generic copy', () => {
    expect(signInCopy('account')).toEqual(signInCopy('nav'));
  });

  it('gives every intent a headline and a subcopy', () => {
    for (const intent of ALL_INTENTS) {
      expect(signInCopy(intent).headline.length).toBeGreaterThan(0);
      expect(signInCopy(intent).subcopy.length).toBeGreaterThan(0);
    }
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

  it('says nothing about email or alerts in the track copy', () => {
    const { headline, subcopy } = signInCopy('track', 'HF 4138');
    const text = `${headline} ${subcopy}`.toLowerCase();
    for (const promise of PROMISES) {
      expect(text).not.toContain(promise);
    }
  });

  it('says nothing about email or alerts in any intent, or in the error copy', () => {
    const strings = [
      ...ALL_INTENTS.flatMap((intent) => {
        const { headline, subcopy } = signInCopy(intent, 'HF 4138');
        return [headline, subcopy];
      }),
      ...Object.values(SIGN_IN_ERROR_MESSAGES),
      SIGN_IN_BUTTON_LABEL,
      SIGN_IN_RETRY_LABEL,
    ];
    for (const value of strings) {
      for (const promise of PROMISES) {
        expect(value.toLowerCase()).not.toContain(promise);
      }
    }
  });

  it('states the payoff we can actually deliver: a saved list', () => {
    expect(signInCopy('track', 'HF 4138').subcopy.toLowerCase()).toContain('tracked bills');
  });
});

// grounded-answers.md rule 2: never advertise what we can't answer. Nothing saves
// a person's district, so the votes gate stays configured and unopenable (#456).
describe('the legislator-votes gate is designed but not live', () => {
  it('marks only tracking and the generic intents as live', () => {
    expect(ALL_INTENTS.filter((intent) => canOpenSignIn(intent)).sort()).toEqual([
      'account',
      'nav',
      'track',
    ]);
    expect(canOpenSignIn('votes')).toBe(false);
  });

  it('refuses to open on the votes intent', () => {
    expect(openedOn('votes').open).toBe(false);
  });

  it('shows the generic dialog rather than the votes one if a stale request comes back', () => {
    const state = signInReducer(initialSignInState, {
      type: 'reopenWithError',
      request: { intent: 'votes' },
      kind: 'failed',
    });
    expect(state.open).toBe(true);
    expect(state.intent).toBe('nav');
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
  it('treats backing out of Google as cancelled, everything else as a failure', () => {
    expect(signInErrorKind('access_denied')).toBe('cancelled');
    expect(signInErrorKind('server_error')).toBe('failed');
    expect(signInErrorKind(null)).toBe('failed');
  });

  it('finds the error in the query string', () => {
    expect(parseAuthError('?error=access_denied&error_description=User+said+no', '')).toEqual({
      code: 'access_denied',
      description: 'User said no',
    });
  });

  it('finds the error in the hash, which is where the implicit flow puts it', () => {
    expect(parseAuthError('', '#error=server_error&error_description=Boom')).toEqual({
      code: 'server_error',
      description: 'Boom',
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
