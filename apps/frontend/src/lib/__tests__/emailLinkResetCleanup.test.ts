import { describe, expect, it, vi } from 'vitest';

import { finishResetSignOuts, updatePasswordOnce } from '../auth/resetCleanup';

function signOutClient(result: () => { error: unknown | null }, calls: string[], name: string) {
  return {
    signOut: vi.fn(async ({ scope }: { scope: 'local' }) => {
      calls.push(`${name}:${scope}`);
      return result();
    }),
  };
}

// The password save itself revokes the reset account's other sessions
// (Supabase's UpdatePassword runs LogoutAllExceptMe in the same transaction,
// pin 0fb56ca9; proven live on this project, #1533) — so the cleanup makes NO
// others-scope call and has no failure state. Its whole job is two local
// clears before the hard load.
describe('password-reset local cleanup', () => {
  it('never asks the provider to sign out other sessions', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = signOutClient(() => ({ error: null }), calls, 'ordinary');

    await finishResetSignOuts(temporary, ordinary, 'same');
    expect(calls).toEqual(['temporary:local', 'ordinary:local']);
  });

  it('finishes past a temporary local error because that client never persists', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: new Error('offline') }), calls, 'temporary');
    const ordinary = signOutClient(() => ({ error: null }), calls, 'ordinary');

    await finishResetSignOuts(temporary, ordinary, 'same');
    expect(calls).toEqual(['temporary:local', 'ordinary:local']);
  });

  it('clears the matching saved session when provider sign-out fails locally', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = signOutClient(() => ({ error: new Error('offline') }), calls, 'ordinary');

    const clearStoredSession = vi.fn();
    await finishResetSignOuts(temporary, ordinary, 'same', clearStoredSession);
    expect(calls).toEqual(['temporary:local', 'ordinary:local']);
    expect(clearStoredSession).toHaveBeenCalledOnce();
  });

  it('still clears the matching saved session when no ordinary client exists', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');

    const clearStoredSession = vi.fn();
    await finishResetSignOuts(temporary, null, 'same', clearStoredSession);
    expect(calls).toEqual(['temporary:local']);
    expect(clearStoredSession).toHaveBeenCalledOnce();
  });

  it('preserves a different ordinary account untouched', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = signOutClient(() => ({ error: null }), calls, 'ordinary');

    await finishResetSignOuts(temporary, ordinary, 'different');
    expect(calls).toEqual(['temporary:local']);
    expect(ordinary.signOut).not.toHaveBeenCalled();
  });

  it('survives a thrown sign-out failure on either client', async () => {
    const throwing = {
      signOut: vi.fn(async (): Promise<{ error: unknown | null }> => {
        throw new Error('offline');
      }),
    };
    const clearStoredSession = vi.fn();

    await expect(finishResetSignOuts(throwing, null, 'none')).resolves.toBeUndefined();
    await expect(
      finishResetSignOuts(throwing, throwing, 'same', clearStoredSession),
    ).resolves.toBeUndefined();
    expect(clearStoredSession).toHaveBeenCalledOnce();
  });
});

describe('one password change, ever', () => {
  it('does not send the new password again once the first change succeeded', async () => {
    const completed = { current: false };
    const update = vi.fn(async () => ({ error: null }));

    await expect(updatePasswordOnce(completed, update)).resolves.toEqual({ error: null });
    await expect(updatePasswordOnce(completed, update)).resolves.toEqual({ error: null });

    expect(completed.current).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('allows a retry when the password change itself was clearly rejected', async () => {
    const completed = { current: false };
    const update = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error('offline') })
      .mockResolvedValueOnce({ error: null });

    expect((await updatePasswordOnce(completed, update)).error).toBeInstanceOf(Error);
    await expect(updatePasswordOnce(completed, update)).resolves.toEqual({ error: null });

    expect(completed.current).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
