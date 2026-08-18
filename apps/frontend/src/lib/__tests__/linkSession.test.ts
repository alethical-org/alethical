import { describe, expect, it } from 'vitest';

import {
  TEMPORARY_AUTH_STORAGE_PREFIX,
  buildEmailLinkRedirectUrl,
  buildTemporaryAuthClientOptions,
  decideTemporarySessionCleanup,
  parseEmailLinkUrl,
  requestedSignInState,
} from '../auth/linkSession';

describe('email-link address handling', () => {
  it('puts every generated email-link value in the browser-only fragment', () => {
    expect(
      buildEmailLinkRedirectUrl('https://www.alethical.com', 'confirm', 'opaque-pending'),
    ).toBe('https://www.alethical.com/confirm#auth_action=confirm&pending=opaque-pending');
    expect(buildEmailLinkRedirectUrl('https://www.alethical.com', 'reset')).toBe(
      'https://www.alethical.com/reset#auth_action=reset',
    );
  });

  it('copies a confirmation token and type from the fragment and removes them from the address', () => {
    expect(
      parseEmailLinkUrl(
        'https://alethical.com/confirm?pending=opaque#token_hash=secret-confirm&type=email',
        'https://alethical.com',
      ),
    ).toEqual({
      link: { tokenHash: 'secret-confirm', type: 'email' },
      cleanPath: '/confirm?pending=opaque',
    });
  });

  it('scrubs a query-string token but refuses to verify with a value already sent to a server', () => {
    expect(
      parseEmailLinkUrl(
        'https://alethical.com/confirm?token_hash=secret-confirm&type=email&pending=opaque',
        'https://alethical.com',
      ),
    ).toEqual({ link: null, cleanPath: '/confirm?pending=opaque' });
  });

  it('copies a recovery token from a parameter-style hash and removes every auth secret', () => {
    expect(
      parseEmailLinkUrl(
        'https://alethical.com/reset?pending=opaque#token_hash=secret-reset&type=recovery&access_token=access&refresh_token=refresh',
        'https://alethical.com',
      ),
    ).toEqual({
      link: { tokenHash: 'secret-reset', type: 'recovery' },
      cleanPath: '/reset?pending=opaque',
    });
  });

  it('removes auth secrets even when the link is incomplete', () => {
    expect(
      parseEmailLinkUrl(
        'https://alethical.com/confirm?token_hash=secret&code=provider-code&pending=opaque',
        'https://alethical.com',
      ),
    ).toEqual({ link: null, cleanPath: '/confirm?pending=opaque' });
  });

  it('drops an unusual fragment rather than leaving an auth secret in the cleaned address', () => {
    expect(
      parseEmailLinkUrl(
        'https://alethical.com/confirm#section?token_hash=secret&type=email',
        'https://alethical.com',
      ),
    ).toEqual({ link: null, cleanPath: '/confirm' });
  });

  it('rejects an address from another website', () => {
    expect(() =>
      parseEmailLinkUrl(
        'https://attacker.example/confirm?token_hash=secret&type=email',
        'https://alethical.com',
      ),
    ).toThrow('same Alethical origin');
  });

  it('only accepts the 2 verification types used by these routes', () => {
    expect(
      parseEmailLinkUrl(
        'https://alethical.com/confirm?token_hash=secret&type=magiclink',
        'https://alethical.com',
      ).link,
    ).toBeNull();
  });
});

describe('requested sign-in screen fallback', () => {
  it('opens Forgot password from the address when browser storage was unavailable', () => {
    expect(requestedSignInState(null, '#auth_screen=forgot')).toEqual({
      screen: 'forgot',
      cleanHash: '',
    });
  });

  it('uses a saved screen first and preserves unrelated address state', () => {
    expect(requestedSignInState('sign-in', '#auth_screen=forgot&section=details')).toEqual({
      screen: 'sign-in',
      cleanHash: '#section=details',
    });
  });
});

describe('temporary Supabase client settings', () => {
  it('does not persist, refresh, detect a browser callback, or share the ordinary storage key', () => {
    const first = buildTemporaryAuthClientOptions(
      'https://project.supabase.co',
      'public-publishable-key',
    );
    const second = buildTemporaryAuthClientOptions(
      'https://project.supabase.co',
      'public-publishable-key',
    );

    expect(first.url).toBe('https://project.supabase.co/auth/v1');
    expect(first.headers).toEqual({
      Authorization: 'Bearer public-publishable-key',
      apikey: 'public-publishable-key',
    });
    expect(first.persistSession).toBe(false);
    expect(first.autoRefreshToken).toBe(false);
    expect(first.detectSessionInUrl).toBe(false);
    expect(first.storageKey).toMatch(new RegExp(`^${TEMPORARY_AUTH_STORAGE_PREFIX}`));
    expect(second.storageKey).not.toBe(first.storageKey);
    expect(first.storageKey).not.toBe('sb-project-auth-token');
  });
});

describe('temporary-session cleanup decisions', () => {
  it('hands the verified session to the ordinary client when no account is open', () => {
    expect(decideTemporarySessionCleanup(null, 'reset-user')).toEqual({
      relationship: 'none',
      handToOrdinaryClient: true,
      clearTemporarySession: false,
    });
  });

  it('clears only the temporary session when the same account is already open', () => {
    expect(decideTemporarySessionCleanup('reset-user', 'reset-user')).toEqual({
      relationship: 'same',
      handToOrdinaryClient: false,
      clearTemporarySession: true,
    });
  });

  it('clears only the temporary session when a different account is open', () => {
    expect(decideTemporarySessionCleanup('marissa-user', 'jordan-user')).toEqual({
      relationship: 'different',
      handToOrdinaryClient: false,
      clearTemporarySession: true,
    });
  });
});
