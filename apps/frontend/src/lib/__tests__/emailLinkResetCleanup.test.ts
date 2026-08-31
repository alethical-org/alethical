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

function clearClient(result: () => boolean, calls: string[]) {
  return {
    clearSessionIfUnchanged: vi.fn(async () => {
      calls.push('ordinary:clear');
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
    const ordinary = clearClient(() => true, calls);
    const savedSession = { access_token: 'saved' };

    await finishResetSignOuts(temporary, ordinary, 'same', savedSession);
    expect(calls).toEqual(['temporary:local', 'ordinary:clear']);
  });

  it('finishes past a temporary local error because that client never persists', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: new Error('offline') }), calls, 'temporary');
    const ordinary = clearClient(() => true, calls);

    await finishResetSignOuts(temporary, ordinary, 'same', { access_token: 'saved' });
    expect(calls).toEqual(['temporary:local', 'ordinary:clear']);
  });

  it('does not clear a newer saved session', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = clearClient(() => false, calls);

    await finishResetSignOuts(temporary, ordinary, 'same', { access_token: 'old' });
    expect(calls).toEqual(['temporary:local', 'ordinary:clear']);
    expect(ordinary.clearSessionIfUnchanged).toHaveBeenCalledOnce();
  });

  it('finishes when no ordinary session exists', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');

    await finishResetSignOuts(temporary, null, 'same', null);
    expect(calls).toEqual(['temporary:local']);
  });

  it('preserves a different ordinary account untouched', async () => {
    const calls: string[] = [];
    const temporary = signOutClient(() => ({ error: null }), calls, 'temporary');
    const ordinary = clearClient(() => true, calls);

    await finishResetSignOuts(temporary, ordinary, 'different');
    expect(calls).toEqual(['temporary:local']);
    expect(ordinary.clearSessionIfUnchanged).not.toHaveBeenCalled();
  });

  it('survives a thrown sign-out failure on either client', async () => {
    const throwing = {
      signOut: vi.fn(async (): Promise<{ error: unknown | null }> => {
        throw new Error('offline');
      }),
    };
    const throwingClear = {
      clearSessionIfUnchanged: vi.fn(async () => {
        throw new Error('offline');
      }),
    };

    await expect(finishResetSignOuts(throwing, null, 'none')).resolves.toBeUndefined();
    await expect(
      finishResetSignOuts(throwing, throwingClear, 'same', { access_token: 'saved' }),
    ).resolves.toBeUndefined();
    expect(throwingClear.clearSessionIfUnchanged).toHaveBeenCalledOnce();
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
