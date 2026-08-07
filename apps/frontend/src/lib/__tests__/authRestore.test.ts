import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTH_RESTORE_TIMEOUT_MESSAGE, restoreAuthSession } from '../authRestore';

interface FakeSession {
  access_token: string;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('restoreAuthSession', () => {
  it('returns the restored session and clears its timer on success', async () => {
    vi.useFakeTimers();
    const session = { access_token: 'token' };

    await expect(
      restoreAuthSession<FakeSession>(() => Promise.resolve({ data: { session }, error: null })),
    ).resolves.toEqual({ session, errorMessage: null, timedOut: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles as signed out when the sign-in service returns a failure', async () => {
    await expect(
      restoreAuthSession<FakeSession>(() =>
        Promise.resolve({ data: { session: null }, error: { message: 'service unavailable' } }),
      ),
    ).resolves.toEqual({
      session: null,
      errorMessage: 'service unavailable',
      timedOut: false,
    });
  });

  it('settles as signed out when session restoration rejects', async () => {
    await expect(
      restoreAuthSession<FakeSession>(() => Promise.reject(new Error('connection failed'))),
    ).resolves.toEqual({
      session: null,
      errorMessage: 'connection failed',
      timedOut: false,
    });
  });

  it('settles as signed out when session restoration never answers', async () => {
    vi.useFakeTimers();
    const restoration = restoreAuthSession<FakeSession>(() => new Promise(() => {}));

    await vi.runAllTimersAsync();

    await expect(restoration).resolves.toEqual({
      session: null,
      errorMessage: AUTH_RESTORE_TIMEOUT_MESSAGE,
      timedOut: true,
    });
  });
});
