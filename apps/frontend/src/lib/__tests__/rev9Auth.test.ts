import { describe, expect, it } from 'vitest';

import {
  REV9_AUTH_MESSAGES,
  createValidRequestGate,
  emailLinkFailureScreen,
  isSafeInternalPath,
  isUncertainPasswordSave,
  mapProviderAuthError,
  normalizeEmail,
  uncertainPasswordSaveMessage,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '../auth/rev9Auth';

describe('rev 9 email and password rules', () => {
  it('normalizes surrounding spaces and email case before a request', () => {
    expect(normalizeEmail('  Jordan.Example@Example.COM  ')).toBe('jordan.example@example.com');
  });

  it('accepts a complete email address and rejects incomplete ones with the approved message', () => {
    expect(validateEmail('jordan@example.com')).toBeNull();
    expect(validateEmail('jordan@example')).toBe(REV9_AUTH_MESSAGES.invalidEmail);
    expect(validateEmail('jordan @example.com')).toBe(REV9_AUTH_MESSAGES.invalidEmail);
  });

  it('requires 15 characters without requiring capitals, numbers, or symbols', () => {
    expect(validatePassword('four calm words!')).toBeNull();
    expect(validatePassword('alllowercasepass')).toBeNull();
    expect(validatePassword('short password')).toBe(REV9_AUTH_MESSAGES.passwordTooShort);
  });

  it('allows spaces and long pasted passwords, including more than 64 characters', () => {
    expect(validatePassword('a few words with spaces')).toBeNull();
    expect(validatePassword('x'.repeat(128))).toBeNull();
  });

  it('reports a mismatch only when the 2 password values differ', () => {
    expect(validatePasswordMatch('a few words with spaces', 'a few words with spaces')).toBeNull();
    expect(validatePasswordMatch('a few words with spaces', 'different words here')).toBe(
      REV9_AUTH_MESSAGES.passwordMismatch,
    );
  });
});

describe('rev 9 provider error copy', () => {
  it('maps wrong credentials to 1 neutral sentence', () => {
    expect(
      mapProviderAuthError({
        code: 'invalid_credentials',
        message: 'User not found. Internal provider detail.',
      }),
    ).toEqual({ kind: 'bad-credentials', message: 'Email or password is incorrect' });
  });

  it('maps an unconfirmed email without exposing provider wording', () => {
    expect(
      mapProviderAuthError(
        { code: 'email_not_confirmed', message: 'Provider says this user exists.' },
        'jordan@example.com',
      ),
    ).toEqual({
      kind: 'email-not-confirmed',
      message: 'Confirm jordan@example.com before signing in',
    });
  });

  it('maps known breached passwords separately from other weak passwords', () => {
    expect(mapProviderAuthError({ code: 'weak_password', reasons: ['pwned'] })).toEqual({
      kind: 'leaked-password',
      message: 'Choose a password that hasn’t appeared in a known data breach',
    });
    expect(mapProviderAuthError({ code: 'weak_password', reasons: ['length'] })).toEqual({
      kind: 'weak-password',
      message: 'Use at least 15 characters. A few words with spaces works well.',
    });
  });

  it('maps throttles and unknown failures without returning the provider message', () => {
    expect(mapProviderAuthError({ code: 'over_request_rate_limit' })).toEqual({
      kind: 'too-many-attempts',
      message: 'Too many attempts. Wait a while, then try again.',
    });
    expect(
      mapProviderAuthError({ code: 'unexpected_failure', message: 'Database host db-1 failed.' }),
    ).toEqual({
      kind: 'request-failure',
      message: 'We couldn’t complete that request. Check your connection and try again.',
    });
  });

  it('maps expired and reused email links to the same safe sentence', () => {
    for (const code of ['otp_expired', 'flow_state_expired', 'refresh_token_already_used']) {
      expect(mapProviderAuthError({ code })).toEqual({
        kind: 'expired-or-used-link',
        message: 'This link has expired or has already been used',
      });
    }
  });

  it('maps an unverified Google return to the sign-in screen banner, never a dead end', () => {
    // Rev 15 removed the match-failure screen as verified unreachable; this
    // result renders on the ordinary sign-in screen with the Google button.
    expect(mapProviderAuthError({ code: 'provider_email_needs_verification' })).toEqual({
      kind: 'unverified-google',
      message:
        'Sign-in couldn’t finish because the email address needs confirmation. If a confirmation email arrives, open the newest one.',
    });
  });

  it('folds the manual-linking conflict codes into the shared request failure', () => {
    // Both can only fire through manual identity linking, which is off.
    for (const code of ['identity_already_exists', 'email_conflict_identity_not_deletable']) {
      expect(mapProviderAuthError({ code })).toEqual({
        kind: 'request-failure',
        message: 'We couldn’t complete that request. Check your connection and try again.',
      });
    }
  });

  it('maps the two Supabase password rejections to their pinned field messages', () => {
    // #1533's two live bugs: a reused password blamed the connection, and an
    // over-72-character password asked for a complete email address on a
    // screen with no email field.
    expect(mapProviderAuthError({ code: 'same_password', status: 422 })).toEqual({
      kind: 'same-password',
      message: 'Choose a different password',
    });
    expect(
      mapProviderAuthError({ code: 'validation_failed', status: 422 }, undefined, {
        passwordSave: true,
      }),
    ).toEqual({
      kind: 'password-too-long',
      message: 'This password is too long. Use a shorter one.',
    });
    // Outside a password save, validation_failed still means a malformed email.
    expect(mapProviderAuthError({ code: 'validation_failed', status: 422 })).toEqual({
      kind: 'invalid-email',
      message: 'Enter a complete email address, like name@example.com',
    });
  });

  it('omits the final period from short 1-step provider messages', () => {
    expect(REV9_AUTH_MESSAGES.humanCheck).toBe(
      'One more step — confirm you’re human, then press the button again',
    );
    expect(mapProviderAuthError({ code: 'reauthentication_needed' })).toEqual({
      kind: 'fresh-proof',
      message: 'Enter the code we sent to confirm it’s you',
    });
    expect(mapProviderAuthError({ code: 'user_already_exists' })).toEqual({
      kind: 'check-email',
      message: 'If this address can create an Alethical account, a confirmation link is on the way',
    });
  });

  it('ends a verified email-link flow only for a deactivated account', () => {
    expect(emailLinkFailureScreen('deactivated')).toBe('deactivated');
    expect(emailLinkFailureScreen('request-failure')).toBe('link-fail');
  });
});

describe('the uncertain password save (REQUEST FAILURE carve-out)', () => {
  it('treats an answered 4xx with a Supabase code as a clear rejection', () => {
    for (const error of [
      { code: 'weak_password', status: 422 },
      { code: 'same_password', status: 422 },
      { code: 'validation_failed', status: 400 },
      { code: 'over_request_rate_limit', status: 429 },
    ]) {
      expect(isUncertainPasswordSave(error), JSON.stringify(error)).toBe(false);
    }
  });

  it('treats a lost or unreadable reply as uncertain, so the save is never re-offered', () => {
    for (const error of [
      new TypeError('Failed to fetch'),
      { status: 0 },
      { code: 'unexpected_failure', status: 500 },
      { status: 502 },
      { code: '', status: 400 },
      null,
      undefined,
    ]) {
      expect(isUncertainPasswordSave(error), JSON.stringify(error) ?? 'undefined').toBe(true);
    }
  });

  it('names the reset account in the pinned banner wording', () => {
    expect(uncertainPasswordSaveMessage('jordan@example.com')).toBe(
      'We couldn’t confirm whether the password for jordan@example.com was saved. If you sign in with email, try the password you entered. If it doesn’t work, reset your password.',
    );
  });
});

describe('one valid press starts one request', () => {
  it('does not lock on an invalid press, then locks synchronously on the first valid press', () => {
    const gate = createValidRequestGate();

    expect(gate.tryStart(false)).toBe(false);
    expect(gate.isLocked()).toBe(false);
    expect(gate.tryStart(true)).toBe(true);
    expect(gate.isLocked()).toBe(true);
    expect(gate.tryStart(true)).toBe(false);
  });

  it('can unlock after the request settles', () => {
    const gate = createValidRequestGate();
    gate.tryStart(true);
    gate.reset();
    expect(gate.tryStart(true)).toBe(true);
  });
});

describe('safe internal return paths', () => {
  it('accepts paths with exactly 1 leading slash', () => {
    expect(isSafeInternalPath('/')).toBe(true);
    expect(isSafeInternalPath('/bills/HF4138?track=1#latest')).toBe(true);
  });

  it('rejects outside addresses, protocol-relative paths, backslashes, and encoded variants', () => {
    for (const path of [
      'https://example.com',
      'javascript:alert(1)',
      '//example.com',
      '/\\example.com',
      '/bills\\example.com',
      '/%5cexample.com',
      '/%2f%2fexample.com',
    ]) {
      expect(isSafeInternalPath(path), path).toBe(false);
    }
  });
});
