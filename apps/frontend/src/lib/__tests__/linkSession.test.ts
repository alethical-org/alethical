import { describe, expect, it, vi } from 'vitest';

import {
  TEMPORARY_AUTH_STORAGE_PREFIX,
  buildEmailLinkRedirectUrl,
  buildTemporaryAuthClientOptions,
  decideTemporarySessionAfterPassword,
  finishTemporarySessionAfterPassword,
  legacyConfirmationPasswordMatches,
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

  // A shared report link ends in a plain section name, not key=value pairs.
  // Rewriting it as pairs appended an '=' and pointed the link at nothing.
  it('leaves an ordinary page fragment exactly as it arrived', () => {
    expect(requestedSignInState(null, '#the-one-way-valve')).toEqual({
      screen: undefined,
      cleanHash: '#the-one-way-valve',
    });
    expect(requestedSignInState(null, '')).toEqual({ screen: undefined, cleanHash: '' });
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

describe('temporary session after a password save', () => {
  it('accepts the password already stored by a real old signup link only', () => {
    const samePassword = { code: 'same_password' };

    expect(legacyConfirmationPasswordMatches('confirm', 'signup', samePassword)).toBe(true);
    expect(legacyConfirmationPasswordMatches('confirm', 'email', samePassword)).toBe(true);
    expect(legacyConfirmationPasswordMatches('reset', 'recovery', samePassword)).toBe(false);
    expect(legacyConfirmationPasswordMatches('confirm', 'signup', { code: 'weak_password' })).toBe(
      false,
    );
  });

  it('hands the verified session to the ordinary client when no account is open', () => {
    expect(decideTemporarySessionAfterPassword(null, 'reset-user')).toEqual({
      relationship: 'none',
      handToOrdinaryClient: true,
      clearTemporarySession: false,
    });
  });

  it('replaces a matching ordinary session because the password save revoked it', () => {
    expect(decideTemporarySessionAfterPassword('reset-user', 'reset-user')).toEqual({
      relationship: 'same',
      handToOrdinaryClient: true,
      clearTemporarySession: false,
    });
  });

  it('clears only the temporary session when a different account is open', () => {
    expect(decideTemporarySessionAfterPassword('marissa-user', 'jordan-user')).toEqual({
      relationship: 'different',
      handToOrdinaryClient: false,
      clearTemporarySession: true,
    });
  });

  it('hands no-account and same-account sessions to the ordinary client without revoking them', async () => {
    for (const ordinaryUserId of [null, 'target-user']) {
      const ordinary = {
        setSession: vi.fn(async () => ({ error: null })),
      };
      const temporary = {
        signOut: vi.fn(async () => ({ error: null })),
      };

      await expect(
        finishTemporarySessionAfterPassword({
          ordinary,
          ordinaryUserId,
          passwordChanged: true,
          session: {
            access_token: 'temporary-access',
            refresh_token: 'temporary-refresh',
            user: { id: 'target-user' },
          },
          temporary,
        }),
      ).resolves.toEqual({
        error: null,
        relationship: ordinaryUserId ? 'same' : 'none',
      });
      expect(ordinary.setSession).toHaveBeenCalledWith({
        access_token: 'temporary-access',
        refresh_token: 'temporary-refresh',
      });
      expect(temporary.signOut).not.toHaveBeenCalled();
    }
  });

  it('preserves a different ordinary account and closes only the temporary session', async () => {
    const ordinary = {
      setSession: vi.fn(async () => ({ error: null })),
    };
    const temporary = {
      signOut: vi.fn(async () => ({ error: null })),
    };

    await expect(
      finishTemporarySessionAfterPassword({
        ordinary,
        ordinaryUserId: 'open-user',
        passwordChanged: true,
        session: {
          access_token: 'temporary-access',
          refresh_token: 'temporary-refresh',
          user: { id: 'target-user' },
        },
        temporary,
      }),
    ).resolves.toEqual({ error: null, relationship: 'different' });
    expect(ordinary.setSession).not.toHaveBeenCalled();
    expect(temporary.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('clears a revoked matching session when handing off the surviving session fails', async () => {
    const clearOrdinarySession = vi.fn();
    const temporary = {
      signOut: vi.fn(async () => ({ error: null })),
    };

    await expect(
      finishTemporarySessionAfterPassword({
        clearOrdinarySession,
        ordinary: {
          setSession: vi.fn(async () => ({ error: new Error('offline') })),
        },
        ordinaryUserId: 'target-user',
        passwordChanged: true,
        session: {
          access_token: 'temporary-access',
          refresh_token: 'temporary-refresh',
          user: { id: 'target-user' },
        },
        temporary,
      }),
    ).resolves.toMatchObject({ relationship: 'same', error: expect.any(Error) });
    expect(clearOrdinarySession).toHaveBeenCalledOnce();
    expect(temporary.signOut).not.toHaveBeenCalled();
  });

  it('keeps a valid matching ordinary session when the password was already the same', async () => {
    const ordinary = {
      setSession: vi.fn(async () => ({ error: null })),
    };
    const temporary = {
      signOut: vi.fn(async () => ({ error: null })),
    };

    await expect(
      finishTemporarySessionAfterPassword({
        ordinary,
        ordinaryUserId: 'target-user',
        passwordChanged: false,
        session: {
          access_token: 'temporary-access',
          refresh_token: 'temporary-refresh',
          user: { id: 'target-user' },
        },
        temporary,
      }),
    ).resolves.toEqual({ error: null, relationship: 'same' });
    expect(ordinary.setSession).not.toHaveBeenCalled();
    expect(temporary.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
