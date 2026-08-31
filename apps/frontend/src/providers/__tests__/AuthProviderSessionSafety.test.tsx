// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  providerSessionIdentity,
  resetProviderSessionRejectionsForTests,
} from '../../lib/auth/providerSessionAcceptance';
import { AuthProvider, useAuth } from '../AuthProvider.web';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const testState = vi.hoisted(() => ({
  authStateListener: null as ((event: string, session: any | null) => void) | null,
  authValue: null as any,
  deactivatedHandler: null as ((accessToken: string) => void) | null,
  clearSessionReplies: [] as Array<Promise<boolean>>,
  getSessionReplies: [] as Array<Promise<any>>,
  restoreReply: Promise.resolve({ session: null, errorMessage: null }) as Promise<any>,
  storedSession: null as any,
  validationReplies: new Map<string, Promise<any>>(),
}));

vi.mock('../../data/api', () => ({
  onAccountDeactivated: vi.fn((handler: (accessToken: string) => void) => {
    testState.deactivatedHandler = handler;
    return vi.fn();
  }),
}));

vi.mock('../../lib/auth/operations', () => ({
  authFailure: (cause: unknown, attemptedEmail?: string) => ({
    ok: false,
    error: {
      cause,
      kind: 'request-failure',
      message: 'Sign-in failed.',
      attemptedEmail,
    },
  }),
  authSuccess: (data?: unknown) => ({ ok: true, data }),
  validateAlethicalSession: vi.fn((session: any) => {
    const reply = testState.validationReplies.get(session.access_token);
    if (!reply) throw new Error(`Missing validation reply for ${session.access_token}`);
    return reply;
  }),
}));

vi.mock('../../lib/auth/passwordFreshProof', () => ({
  savePasswordWithFreshProof: vi.fn(),
}));

vi.mock('../../lib/auth/sessionSafety', () => ({
  signOutLocallyAndVerify: vi.fn(async () => ({ signedOut: true, error: null })),
  validationFailureRevokesSession: vi.fn(() => false),
}));

vi.mock('../../lib/authRestore', () => ({
  restoreAuthSession: vi.fn(() => testState.restoreReply),
}));

vi.mock('../../lib/supabase', () => ({
  clearOrdinarySessionIfUnchanged: vi.fn(() => {
    const reply = testState.clearSessionReplies.shift();
    return reply ?? Promise.resolve(false);
  }),
  isSupabaseConfigured: true,
  passwordClientForOrdinarySession: vi.fn(() => ({})),
  supabase: {
    auth: {
      getSession: vi.fn(() => {
        const reply = testState.getSessionReplies.shift();
        return (
          reply ?? Promise.resolve({ data: { session: testState.storedSession }, error: null })
        );
      }),
      onAuthStateChange: vi.fn((listener: (event: string, session: any | null) => void) => {
        testState.authStateListener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
    },
  },
}));

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  messageListener: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  close = vi.fn();
  postMessage = vi.fn();

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.messageListener = listener;
  }

  receiveFromAnotherTab(data: unknown) {
    this.messageListener?.({ data } as MessageEvent);
  }
}

function accessToken(userId: string, sessionId: string, suffix: string) {
  const payload = globalThis
    .btoa(JSON.stringify({ session_id: sessionId, sub: userId }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.${suffix}`;
}

function providerSession(userId: string, sessionId: string, token: string) {
  return {
    access_token: accessToken(userId, sessionId, token),
    refresh_token: `refresh-${token}`,
    user: { email: `${userId}@example.com`, id: userId },
  } as any;
}

function alethicalUser(id: string) {
  return {
    email: `${id}@example.com`,
    id: `alethical-${id}`,
    signInMethods: { google: true, password: false },
  };
}

function validationSuccess(id: string) {
  return { data: alethicalUser(id), ok: true };
}

function AuthProbe() {
  testState.authValue = useAuth();
  return null;
}

describe('AuthProvider session races', () => {
  let mount: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    resetProviderSessionRejectionsForTests();
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    testState.authStateListener = null;
    testState.authValue = null;
    testState.deactivatedHandler = null;
    testState.clearSessionReplies = [];
    testState.getSessionReplies = [];
    testState.restoreReply = Promise.resolve({ session: null, errorMessage: null });
    testState.storedSession = null;
    testState.validationReplies.clear();
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    mount?.remove();
    root = null;
    mount = null;
    resetProviderSessionRejectionsForTests();
    vi.unstubAllGlobals();
  });

  async function mountProvider(settleStartup = true) {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    await act(async () => {
      root?.render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>,
      );
    });
    await vi.waitFor(() => expect(testState.authStateListener).not.toBeNull());
    if (settleStartup) {
      await vi.waitFor(() => expect(testState.authValue.isLoading).toBe(false));
    }
  }

  async function emitAuthSession(session: any | null) {
    await act(async () => {
      testState.authStateListener?.(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
      await Promise.resolve();
    });
  }

  async function rejectFromAnotherTab(session: any) {
    const channel = FakeBroadcastChannel.instances.find(
      (candidate) => candidate.name === 'alethical.auth.cancelled-session',
    );
    expect(channel).toBeDefined();
    await act(async () => {
      channel?.receiveFromAnotherTab(providerSessionIdentity(session));
    });
  }

  async function reportDeactivated(requestSession: any) {
    await act(async () => {
      testState.deactivatedHandler?.(requestSession.access_token);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('never shows a session another tab rejects while validation is pending', async () => {
    await mountProvider();
    const pendingValidation = deferred<any>();
    const first = providerSession('person', 'session-1', 'first');
    testState.validationReplies.set(first.access_token, pendingValidation.promise);
    testState.storedSession = first;

    await emitAuthSession(first);
    await vi.waitFor(() => expect(testState.authValue.isLoading).toBe(true));
    await rejectFromAnotherTab(first);

    await act(async () => pendingValidation.resolve(validationSuccess('person')));
    await vi.waitFor(() => expect(testState.authValue.isLoading).toBe(false));

    expect(testState.authValue.isSignedIn).toBe(false);
    expect(testState.authValue.accessToken).toBeNull();
    expect(testState.authValue.user).toBeNull();
  });

  it('clears a visible rejected session but keeps a fresh sign-in for the same person', async () => {
    await mountProvider();
    const first = providerSession('person', 'session-1', 'first');
    const fresh = providerSession('person', 'session-2', 'fresh');
    testState.validationReplies.set(
      first.access_token,
      Promise.resolve(validationSuccess('person')),
    );
    testState.storedSession = first;

    await emitAuthSession(first);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(first.access_token));

    await rejectFromAnotherTab(first);
    await vi.waitFor(() => expect(testState.authValue.isSignedIn).toBe(false));

    testState.validationReplies.set(
      fresh.access_token,
      Promise.resolve(validationSuccess('person')),
    );
    testState.storedSession = fresh;
    await emitAuthSession(fresh);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(fresh.access_token));

    await rejectFromAnotherTab(first);
    expect(testState.authValue.isSignedIn).toBe(true);
    expect(testState.authValue.accessToken).toBe(fresh.access_token);
  });

  it('shows the refreshed form of the session that finished validation', async () => {
    await mountProvider();
    const pendingValidation = deferred<any>();
    const first = providerSession('person', 'session-1', 'first');
    const refreshed = providerSession('person', 'session-1', 'refreshed');
    testState.validationReplies.set(first.access_token, pendingValidation.promise);
    testState.storedSession = first;

    await emitAuthSession(first);
    testState.storedSession = refreshed;
    await act(async () => pendingValidation.resolve(validationSuccess('person')));

    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(refreshed.access_token));
    expect(testState.authValue.isSignedIn).toBe(true);
  });

  it('does not use an old validation to show a fresh session for the same person', async () => {
    await mountProvider();
    const pendingValidation = deferred<any>();
    const first = providerSession('person', 'session-1', 'first');
    const fresh = providerSession('person', 'session-2', 'fresh');
    testState.validationReplies.set(first.access_token, pendingValidation.promise);
    testState.storedSession = first;

    await emitAuthSession(first);
    testState.storedSession = fresh;
    await act(async () => pendingValidation.resolve(validationSuccess('person')));

    await vi.waitFor(() => expect(testState.authValue.isLoading).toBe(false));
    expect(testState.authValue.isSignedIn).toBe(false);
    expect(testState.authValue.accessToken).toBeNull();
    expect(testState.authValue.user).toBeNull();
  });

  it('ignores a stale startup error while a newer sign-in is still loading', async () => {
    const startup = deferred<any>();
    const pendingValidation = deferred<any>();
    const fresh = providerSession('person', 'session-2', 'fresh');
    testState.restoreReply = startup.promise;
    testState.validationReplies.set(fresh.access_token, pendingValidation.promise);
    testState.storedSession = fresh;
    await mountProvider(false);

    await emitAuthSession(fresh);
    await vi.waitFor(() => expect(testState.authValue.isLoading).toBe(true));
    await act(async () => startup.resolve({ session: null, errorMessage: 'Old startup error' }));

    expect(testState.authValue.authError).toBeNull();
    expect(testState.authValue.isLoading).toBe(true);

    await act(async () => pendingValidation.resolve(validationSuccess('person')));
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(fresh.access_token));
    expect(testState.authValue.authError).toBeNull();
  });

  it('does not let a stale startup exception clear a newer visible sign-in', async () => {
    const startup = deferred<any>();
    const fresh = providerSession('person', 'session-2', 'fresh');
    testState.restoreReply = startup.promise;
    testState.validationReplies.set(
      fresh.access_token,
      Promise.resolve(validationSuccess('person')),
    );
    testState.storedSession = fresh;
    await mountProvider(false);

    await emitAuthSession(fresh);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(fresh.access_token));

    await act(async () => startup.reject(new Error('Old startup failed')));

    expect(testState.authValue.accessToken).toBe(fresh.access_token);
    expect(testState.authValue.user).toEqual(alethicalUser('person'));
    expect(testState.authValue.authError).toBeNull();
  });

  it('clears the current session when a signed-out storage check fails', async () => {
    await mountProvider();
    const current = providerSession('person', 'session-1', 'current');
    testState.validationReplies.set(
      current.access_token,
      Promise.resolve(validationSuccess('person')),
    );
    testState.storedSession = current;
    await emitAuthSession(current);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(current.access_token));

    const failedRead = deferred<any>();
    testState.getSessionReplies.push(failedRead.promise);
    await emitAuthSession(null);
    await act(async () => failedRead.reject(new Error('Storage read failed')));

    await vi.waitFor(() => expect(testState.authValue.isLoading).toBe(false));
    expect(testState.authValue.isSignedIn).toBe(false);
    expect(testState.authValue.accessToken).toBeNull();
    expect(testState.authValue.user).toBeNull();
  });

  it('does not let an old failed signed-out check clear a newer sign-in', async () => {
    await mountProvider();
    const old = providerSession('person', 'session-1', 'old');
    const fresh = providerSession('person', 'session-2', 'fresh');
    testState.validationReplies.set(old.access_token, Promise.resolve(validationSuccess('person')));
    testState.validationReplies.set(
      fresh.access_token,
      Promise.resolve(validationSuccess('person')),
    );
    testState.storedSession = old;
    await emitAuthSession(old);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(old.access_token));

    const failedRead = deferred<any>();
    testState.getSessionReplies.push(failedRead.promise);
    await emitAuthSession(null);

    testState.storedSession = fresh;
    await emitAuthSession(fresh);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(fresh.access_token));
    await act(async () => failedRead.reject(new Error('Old storage read failed')));

    expect(testState.authValue.isSignedIn).toBe(true);
    expect(testState.authValue.accessToken).toBe(fresh.access_token);
    expect(testState.authValue.user).toEqual(alethicalUser('person'));
  });

  it('ignores a delayed deactivation reply from a different provider account', async () => {
    await mountProvider();
    const accountA = providerSession('account-a', 'session-a', 'request-a');
    const accountB = providerSession('account-b', 'session-b', 'current-b');
    testState.validationReplies.set(
      accountB.access_token,
      Promise.resolve(validationSuccess('account-b')),
    );
    testState.storedSession = accountB;
    await emitAuthSession(accountB);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(accountB.access_token));

    await reportDeactivated(accountA);

    expect(testState.authValue.accessToken).toBe(accountB.access_token);
    expect(testState.authValue.authErrorKind).toBeNull();
  });

  it('does not show an old deactivation error over a newer visible account', async () => {
    await mountProvider();
    const accountA = providerSession('account-a', 'session-a', 'request-a');
    const accountB = providerSession('account-b', 'session-b', 'current-b');
    const delayedClear = deferred<boolean>();
    testState.validationReplies.set(
      accountA.access_token,
      Promise.resolve(validationSuccess('account-a')),
    );
    testState.validationReplies.set(
      accountB.access_token,
      Promise.resolve(validationSuccess('account-b')),
    );
    testState.storedSession = accountA;
    await emitAuthSession(accountA);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(accountA.access_token));

    testState.clearSessionReplies.push(delayedClear.promise);
    await act(async () => {
      testState.deactivatedHandler?.(accountA.access_token);
      await Promise.resolve();
    });

    testState.storedSession = accountB;
    await emitAuthSession(accountB);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(accountB.access_token));
    await act(async () => {
      delayedClear.resolve(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testState.authValue.accessToken).toBe(accountB.access_token);
    expect(testState.authValue.authErrorKind).toBeNull();
  });

  it('rejects a fresh same-user session that is still validating after deactivation', async () => {
    await mountProvider();
    const visible = providerSession('person', 'session-a', 'visible-a');
    const pending = providerSession('person', 'session-b', 'pending-b');
    const pendingValidation = deferred<any>();
    testState.validationReplies.set(
      visible.access_token,
      Promise.resolve(validationSuccess('person')),
    );
    testState.storedSession = visible;
    await emitAuthSession(visible);
    await vi.waitFor(() => expect(testState.authValue.accessToken).toBe(visible.access_token));

    testState.validationReplies.set(pending.access_token, pendingValidation.promise);
    testState.storedSession = pending;
    await emitAuthSession(pending);
    await reportDeactivated(visible);
    await act(async () => pendingValidation.resolve(validationSuccess('person')));

    await vi.waitFor(() => expect(testState.authValue.isSignedIn).toBe(false));
    expect(testState.authValue.authErrorKind).toBe('deactivated');
  });
});
