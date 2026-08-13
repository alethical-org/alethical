import { describe, expect, it, vi } from 'vitest';

import { finishResetSignOuts, updatePasswordOnce } from '../auth/resetCleanup';

function signOutClient(
  result: (scope: 'others' | 'local') => { error: unknown | null },
  calls: string[],
  name: string,
) {
  return {
    signOut: vi.fn(async ({ scope }: { scope: 'others' | 'local' }) => {
      calls.push(`${name}:${scope}`);
      return result(scope);
    }),
  };
}

describe('password-reset sign-out cleanup', () => {
  it('stops in the safe retry state when other reset sessions cannot be signed out', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(
      (scope) => ({ error: scope === 'others' ? new Error('offline') : null }),
      calls,
      'temporary',
    );
    const ordinary = signOutClient(() => ({ error: null }), calls, 'ordinary');

    await expect(finishResetSignOuts(temporary, ordinary, 'same')).resolves.toBe(false);
    expect(calls).toEqual(['temporary:others']);
  });

  it('hard-loads past a temporary local error because that client never persists', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(
      (scope) => ({ error: scope === 'local' ? new Error('offline') : null }),
      calls,
      'temporary',
    );
    const ordinary = signOutClient(() => ({ error: null }), calls, 'ordinary');

    await expect(finishResetSignOuts(temporary, ordinary, 'same')).resolves.toBe(true);
    expect(calls).toEqual(['temporary:others', 'temporary:local', 'ordinary:local']);
  });

  it('clears the matching saved session when provider sign-out fails locally', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = signOutClient(() => ({ error: new Error('offline') }), calls, 'ordinary');

    const clearStoredSession = vi.fn();
    await expect(
      finishResetSignOuts(temporary, ordinary, 'same', clearStoredSession),
    ).resolves.toBe(true);
    expect(calls).toEqual(['temporary:others', 'temporary:local', 'ordinary:local']);
    expect(clearStoredSession).toHaveBeenCalledOnce();
  });

  it('stays safe when a matching ordinary account has no sign-out client', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');

    await expect(finishResetSignOuts(temporary, null, 'same')).resolves.toBe(false);
    expect(calls).toEqual(['temporary:others', 'temporary:local']);
  });

  it('preserves a different ordinary account', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = signOutClient(() => ({ error: null }), calls, 'ordinary');

    await expect(finishResetSignOuts(temporary, ordinary, 'different')).resolves.toBe(true);
    expect(calls).toEqual(['temporary:others', 'temporary:local']);
    expect(ordinary.signOut).not.toHaveBeenCalled();
  });

  it('turns a thrown sign-out failure into a safe retry result', async () => {
    const temporary = {
      signOut: vi.fn(async () => {
        throw new Error('offline');
      }),
    };

    await expect(finishResetSignOuts(temporary, null, 'none')).resolves.toBe(false);
  });
});

describe('one password change across cleanup retries', () => {
  it('does not send the new password again after the first change succeeded', async () => {
    const completed = { current: false };
    const update = vi.fn(async () => ({ error: null }));
    const calls: string[] = [];
    let failOtherSessions = true;
    const temporary = signOutClient(
      (scope) => {
        if (scope === 'others' && failOtherSessions) {
          failOtherSessions = false;
          return { error: new Error('offline') };
        }
        return { error: null };
      },
      calls,
      'temporary',
    );

    await expect(updatePasswordOnce(completed, update)).resolves.toEqual({ error: null });
    await expect(finishResetSignOuts(temporary, null, 'none')).resolves.toBe(false);
    await expect(updatePasswordOnce(completed, update)).resolves.toEqual({ error: null });
    await expect(finishResetSignOuts(temporary, null, 'none')).resolves.toBe(true);

    expect(completed.current).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('allows a retry when the password change itself failed', async () => {
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
