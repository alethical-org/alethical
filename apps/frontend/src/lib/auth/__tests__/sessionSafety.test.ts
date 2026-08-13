import { describe, expect, it, vi } from 'vitest';

import {
  clearStoredProviderSession,
  signOutLocallyAndVerify,
  validationFailureRevokesSession,
} from '../sessionSafety';

describe('verified local sign-out', () => {
  it('uses the session read as truth even when the provider reports a sign-out error', async () => {
    const auth = {
      signOut: vi.fn().mockResolvedValue({ error: { message: 'provider unavailable' } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    };

    await expect(signOutLocallyAndVerify(auth)).resolves.toEqual({
      signedOut: true,
      error: null,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.getSession).toHaveBeenCalledOnce();
  });

  it('fails safely when a session remains', async () => {
    const session = { access_token: 'still-signed-in' };
    const auth = {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    };

    await expect(signOutLocallyAndVerify(auth)).resolves.toEqual({
      signedOut: false,
      error: null,
    });
  });

  it('fails safely when the remaining session cannot be read', async () => {
    const readError = { message: 'offline' };
    const auth = {
      signOut: vi.fn().mockRejectedValue(new Error('sign-out request failed')),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: readError }),
    };

    await expect(signOutLocallyAndVerify(auth)).resolves.toEqual({
      signedOut: false,
      error: readError,
    });
    expect(auth.getSession).toHaveBeenCalledOnce();
  });
});

describe('Alethical session validation failures', () => {
  it('keeps the provider session after a temporary request failure', () => {
    expect(validationFailureRevokesSession('request-failure')).toBe(false);
  });

  it('revokes identities that Alethical proved unsafe to use', () => {
    expect(validationFailureRevokesSession('deactivated')).toBe(true);
    expect(validationFailureRevokesSession('match-failed')).toBe(true);
  });
});

describe('unsafe saved-session cleanup', () => {
  it('removes the durable session and its one-use code record', async () => {
    const storage = { removeItem: vi.fn() };

    await clearStoredProviderSession(storage, 'sb-project-auth-token');

    expect(storage.removeItem.mock.calls).toEqual([
      ['sb-project-auth-token'],
      ['sb-project-auth-token-code-verifier'],
    ]);
  });

  it('still attempts every saved record when one removal fails', async () => {
    const storage = {
      removeItem: vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined),
    };

    await clearStoredProviderSession(storage, 'sb-project-auth-token');

    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });
});
