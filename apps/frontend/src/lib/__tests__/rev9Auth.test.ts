import { describe, expect, it } from 'vitest';

import {
  REV9_AUTH_MESSAGES,
  createValidRequestGate,
  isSafeInternalPath,
  mapProviderAuthError,
  normalizeEmail,
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
    ).toEqual({ kind: 'bad-credentials', message: 'Email or password is incorrect.' });
  });

  it('maps an unconfirmed email without exposing provider wording', () => {
    expect(
      mapProviderAuthError(
        { code: 'email_not_confirmed', message: 'Provider says this user exists.' },
        'jordan@example.com',
      ),
    ).toEqual({
      kind: 'email-not-confirmed',
      message: 'Confirm jordan@example.com before signing in.',
    });
  });

  it('maps known breached passwords separately from other weak passwords', () => {
    expect(mapProviderAuthError({ code: 'weak_password', reasons: ['pwned'] })).toEqual({
      kind: 'leaked-password',
      message: 'Choose a password that hasn’t appeared in a known data breach.',
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
        message: 'This link has expired or has already been used.',
      });
    }
  });

  it('maps an unsafe provider-email match to the approved match failure', () => {
    expect(mapProviderAuthError({ code: 'provider_email_needs_verification' })).toEqual({
      kind: 'match-failed',
      message:
        'We couldn’t safely match this sign-in to your account. Sign in with the method you used before.',
    });
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
