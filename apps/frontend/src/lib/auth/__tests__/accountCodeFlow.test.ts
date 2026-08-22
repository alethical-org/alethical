import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClient } from '@supabase/auth-js';

import {
  AccountCodeAccessController,
  accountCodeRelationship,
  readStableOrdinaryAccount,
  requestAccountCode,
  verifyAccountCode,
} from '../accountCodeFlow';
import { resetProviderSessionRejectionsForTests } from '../providerSessionAcceptance';

afterEach(() => resetProviderSessionRejectionsForTests());

function client(methods: Record<string, unknown>) {
  return methods as unknown as InstanceType<typeof AuthClient>;
}

function session(id: string, email = `${id}@example.com`) {
  return {
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
    user: { id, email },
  } as any;
}

function lineageSession(id: string, token: string, sessionId: string) {
  const payload = globalThis
    .btoa(JSON.stringify({ sub: id, session_id: sessionId }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return {
    access_token: `header.${payload}.${token}`,
    refresh_token: `refresh-${token}`,
    user: { id, email: `${id}@example.com` },
  } as any;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function controller({
  purpose = 'recover',
  target = session('target'),
  ordinarySession = null,
  ordinaryAccountId,
  updateError = null,
  validate = vi.fn(
    async () =>
      ({
        ok: true,
        data: {
          id: 'target',
          email: 'target@example.com',
          name: 'Target',
          signInMethods: { google: false, password: true },
        },
      }) as const,
  ),
}: {
  purpose?: 'create' | 'recover';
  target?: any;
  ordinarySession?: any;
  ordinaryAccountId?: string;
  updateError?: any;
  validate?: any;
} = {}) {
  const signInWithOtp = vi.fn(async () => ({ error: null }));
  const verifyOtp = vi.fn(async () => ({ data: { session: target }, error: null }));
  const updateUser = vi.fn(async () => ({ error: updateError }));
  const signOut = vi.fn(async (_options?: { scope?: string }) => ({ error: null }));
  const temporarySessionState = { current: target };
  const getTemporarySession = vi.fn(async () => ({
    data: { session: temporarySessionState.current },
    error: null,
  }));
  const ordinarySessionState = { current: ordinarySession };
  const getSession = vi.fn(async () => ({
    data: { session: ordinarySessionState.current },
    error: null,
  }));
  const setSession = vi.fn(
    async (tokens: { access_token: string; refresh_token: string }): Promise<{ error: any }> => {
      const id = tokens.access_token.replace(/^access-/, '');
      ordinarySessionState.current = session(id);
      return { error: null };
    },
  );
  const clearOrdinarySession = vi.fn(() => {
    ordinarySessionState.current = null;
  });
  const setSessionIfUnchanged = vi.fn(
    async (expected: any, tokens: { access_token: string; refresh_token: string }) => {
      const current = ordinarySessionState.current;
      const unchanged = expected
        ? current?.access_token === expected.access_token &&
          current?.refresh_token === expected.refresh_token &&
          current?.user.id === expected.user.id
        : current === null;
      if (!unchanged) return { changed: true, data: { session: current }, error: null };
      const result = await setSession(tokens);
      return {
        changed: false,
        data: { session: ordinarySessionState.current },
        error: result.error,
      };
    },
  );
  const clearSessionIfUnchanged = vi.fn(async (expected: any) => {
    const current = ordinarySessionState.current;
    const unchanged =
      current?.access_token === expected.access_token &&
      current?.refresh_token === expected.refresh_token &&
      current?.user.id === expected.user.id;
    if (!unchanged) return false;
    clearOrdinarySession();
    return true;
  });
  const readOrdinaryAccount = vi.fn(async () => {
    const openSession = ordinarySessionState.current;
    if (!openSession) return null;
    const accountId = ordinaryAccountId ?? openSession.user.id;
    return {
      session: openSession,
      account: {
        id: accountId,
        email: `${accountId}@example.com`,
        name: accountId,
        signInMethods: { google: false, password: true },
      },
    };
  });
  const completePending = vi.fn(async () => undefined);
  const temporary = client({
    signInWithOtp,
    verifyOtp,
    updateUser,
    signOut,
    getSession: getTemporarySession,
  });
  const ordinary = { getSession, setSessionIfUnchanged, clearSessionIfUnchanged };
  const access = new AccountCodeAccessController(
    purpose,
    'target@example.com',
    temporary,
    ordinary,
    validate,
    readOrdinaryAccount,
    completePending,
  );
  return {
    access,
    completePending,
    getSession,
    getTemporarySession,
    ordinarySessionState,
    readOrdinaryAccount,
    setSessionIfUnchanged,
    setSession,
    signOut,
    temporarySessionState,
    updateUser,
    validate,
    verifyOtp,
    clearOrdinarySession,
  };
}

describe('shared account email code', () => {
  it('uses 1 account-creating request for create, recover, and retry', async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const auth = client({ signInWithOtp });

    await requestAccountCode(auth, ' Person@Example.com ', 'https://www.alethical.com/confirm');
    await requestAccountCode(auth, 'person@example.com', 'https://www.alethical.com/confirm');

    expect(signInWithOtp).toHaveBeenCalledTimes(2);
    expect(signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: 'person@example.com',
      options: {
        emailRedirectTo: 'https://www.alethical.com/confirm',
        shouldCreateUser: true,
      },
    });
    expect(signInWithOtp.mock.calls[1]).toEqual(signInWithOtp.mock.calls[0]);
  });

  it('verifies every email code with the shared email type', async () => {
    const session = {
      access_token: 'access',
      refresh_token: 'refresh',
      user: { id: 'target' },
    };
    const verifyOtp = vi.fn(async () => ({ data: { session }, error: null }));

    const result = await verifyAccountCode(client({ verifyOtp }), 'person@example.com', ' 123456 ');

    expect(result).toEqual({ ok: true, data: session });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('keeps wrong and expired code failures on the code screen', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { session: null },
      error: { code: 'otp_expired', status: 403 },
    }));

    const result = await verifyAccountCode(client({ verifyOtp }), 'person@example.com', '123456');

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'wrong-or-expired-code',
        message: 'That code is wrong or expired. Enter the newest code or send a new one.',
      },
    });
  });

  it('compares the proved account with the latest open account', () => {
    expect(accountCodeRelationship(null, 'target')).toBe('none');
    expect(accountCodeRelationship('target', 'target')).toBe('same');
    expect(accountCodeRelationship('other', 'target')).toBe('different');
  });

  it('rechecks the open account when its provider session changes during validation', async () => {
    const first = session('first-provider');
    const second = session('second-provider');
    let current = first;
    const getSession = vi.fn(async () => ({ data: { session: current }, error: null }));
    const validate = vi
      .fn()
      .mockImplementationOnce(async () => {
        current = second;
        return {
          ok: true,
          data: {
            id: 'old-account',
            email: 'old@example.com',
            name: 'Old',
            signInMethods: null,
          },
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'new-account',
          email: 'new@example.com',
          name: 'New',
          signInMethods: null,
        },
      });

    const result = await readStableOrdinaryAccount({ getSession }, validate);

    expect(result).toMatchObject({ session: second, account: { id: 'new-account' } });
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('reuses a spent code when account validation needs a retry', async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'request-failure', message: 'Try again' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'target',
          email: 'target@example.com',
          name: 'Target',
          signInMethods: { google: false, password: false },
        },
      });
    const flow = controller({ validate });

    expect((await flow.access.verify('123456')).ok).toBe(false);
    expect((await flow.access.verify('123456')).ok).toBe(true);
    expect(flow.verifyOtp).toHaveBeenCalledOnce();
    expect(flow.completePending).toHaveBeenCalledOnce();
  });

  it('cleans up a verified session whose returned email does not match', async () => {
    const flow = controller({ target: session('target', 'someone-else@example.com') });

    expect((await flow.access.verify('123456')).ok).toBe(false);
    expect(flow.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(flow.validate).not.toHaveBeenCalled();
  });

  it('does not finish verification after the flow is closed', async () => {
    const flow = controller();
    const reply = deferred<{ data: { session: any }; error: null }>();
    flow.verifyOtp.mockImplementationOnce(() => reply.promise);

    const verifying = flow.access.verify('123456');
    await vi.waitFor(() => expect(flow.verifyOtp).toHaveBeenCalledOnce());
    await flow.access.dispose();
    reply.resolve({ data: { session: session('target') }, error: null });

    expect((await verifying).ok).toBe(false);
    expect(flow.completePending).not.toHaveBeenCalled();
    expect(flow.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('leaves a same account unchanged before Create shows password entry', async () => {
    const flow = controller({ purpose: 'create', ordinarySession: session('target') });
    await flow.access.verify('123456');

    const result = await flow.access.finishCreateIfSameAccountOpen();

    expect(result).toEqual({ ok: true, data: true });
    expect(flow.updateUser).not.toHaveBeenCalled();
    expect(flow.setSession).not.toHaveBeenCalled();
    expect(flow.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('saves the typed Create password if the same account opens after password entry', async () => {
    const flow = controller({ purpose: 'create' });
    await flow.access.verify('123456');
    expect(await flow.access.finishCreateIfSameAccountOpen()).toEqual({ ok: true, data: false });
    flow.ordinarySessionState.current = session('target');

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({
      ok: true,
      data: { relationship: 'same', passwordStatus: 'saved' },
    });
    expect(flow.updateUser).toHaveBeenCalledOnce();
  });

  it('preserves a fresh same-user sign-in created after the password save began', async () => {
    const ordinaryBefore = lineageSession('target', 'ordinary-before', 'old-session');
    const ordinaryAfter = lineageSession('target', 'ordinary-after', 'fresh-session');
    const flow = controller({ ordinarySession: ordinaryBefore });
    await flow.access.verify('123456');
    flow.updateUser.mockImplementationOnce(async () => {
      flow.ordinarySessionState.current = ordinaryAfter;
      return { error: null };
    });

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({
      ok: true,
      data: { relationship: 'same', handedToOrdinaryClient: false },
    });
    expect(flow.setSessionIfUnchanged).not.toHaveBeenCalled();
    expect(flow.clearOrdinarySession).not.toHaveBeenCalled();
    expect(flow.ordinarySessionState.current).toBe(ordinaryAfter);
  });

  it('treats 2 sign-in identities joined to 1 Alethical account as the same account', async () => {
    const flow = controller({
      target: session('email-provider', 'target@example.com'),
      ordinarySession: session('google-provider'),
      ordinaryAccountId: 'target',
    });
    await flow.access.verify('123456');

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({
      ok: true,
      data: { relationship: 'same', requiresAccountChoice: false },
    });
    expect(flow.setSession).not.toHaveBeenCalled();
    expect(flow.clearOrdinarySession).not.toHaveBeenCalled();
  });

  it('hands a saved password session to no or same open account', async () => {
    for (const ordinarySession of [null, session('target')]) {
      const flow = controller({ ordinarySession });
      await flow.access.verify('123456');

      const result = await flow.access.savePassword('password');

      expect(result).toMatchObject({
        ok: true,
        data: { passwordStatus: 'saved', requiresAccountChoice: false },
      });
      expect(flow.setSession).toHaveBeenCalledWith({
        access_token: 'access-target',
        refresh_token: 'refresh-target',
      });
      expect(flow.signOut).not.toHaveBeenCalledWith({ scope: 'local' });
    }
  });

  it('hands off the refreshed temporary session after saving the password', async () => {
    const before = lineageSession('target', 'before', 'temporary-session');
    const after = lineageSession('target', 'after', 'temporary-session');
    const flow = controller({ target: before });
    await flow.access.verify('123456');
    flow.temporarySessionState.current = after;
    flow.setSessionIfUnchanged.mockResolvedValueOnce({
      changed: false,
      data: { session: after },
      error: null,
    });

    const result = await flow.access.savePassword('password');

    expect(result.ok).toBe(true);
    expect(flow.setSessionIfUnchanged).toHaveBeenCalledWith(null, {
      access_token: after.access_token,
      refresh_token: after.refresh_token,
    });
  });

  it('keeps a different account until Keep or Switch is pressed', async () => {
    const keep = controller({ ordinarySession: session('other') });
    await keep.access.verify('123456');
    expect(await keep.access.savePassword('password')).toMatchObject({
      ok: true,
      data: { relationship: 'different', requiresAccountChoice: true },
    });
    expect(keep.setSession).not.toHaveBeenCalled();
    expect(keep.signOut).not.toHaveBeenCalled();
    await keep.access.keepCurrentAccount();
    expect(keep.signOut).toHaveBeenCalledWith({ scope: 'local' });

    const change = controller({ ordinarySession: session('other') });
    await change.access.verify('123456');
    await change.access.savePassword('password');
    await change.access.switchAccount();
    expect(change.setSession).toHaveBeenCalledWith({
      access_token: 'access-target',
      refresh_token: 'refresh-target',
    });
    expect(change.signOut).not.toHaveBeenCalled();
  });

  it('never repeats a password save whose reply is unknown', async () => {
    const flow = controller({ updateError: new Error('connection lost') });
    await flow.access.verify('123456');

    const first = await flow.access.savePassword('password');
    const second = await flow.access.retryFinish();

    expect(first).toMatchObject({ ok: true, data: { passwordStatus: 'unknown' } });
    expect(second).toMatchObject({ ok: true, data: { passwordStatus: 'unknown' } });
    expect(flow.updateUser).toHaveBeenCalledOnce();
    expect(flow.setSession).toHaveBeenCalledOnce();
  });

  it('does not hand off a password reply after the flow is closed', async () => {
    const flow = controller({ ordinarySession: session('target') });
    const reply = deferred<{ error: null }>();
    flow.updateUser.mockImplementationOnce(() => reply.promise);
    await flow.access.verify('123456');

    const saving = flow.access.savePassword('password');
    await vi.waitFor(() => expect(flow.updateUser).toHaveBeenCalledOnce());
    let cleanupFinished = false;
    const cleanup = flow.access.dispose().then(() => {
      cleanupFinished = true;
    });
    await Promise.resolve();
    expect(cleanupFinished).toBe(false);
    flow.ordinarySessionState.current = session('newer');
    reply.resolve({ error: null });

    expect(await saving).toMatchObject({
      ok: false,
      canRetryPassword: false,
      passwordStatus: 'unknown',
    });
    await cleanup;
    expect(flow.setSession).not.toHaveBeenCalled();
    expect(flow.clearOrdinarySession).not.toHaveBeenCalled();
    expect(flow.ordinarySessionState.current?.user.id).toBe('newer');
  });

  it('clears a late automatic handoff after the flow is closed', async () => {
    const flow = controller();
    const reply = deferred<{
      changed: false;
      data: { session: any };
      error: null;
    }>();
    flow.setSessionIfUnchanged.mockImplementationOnce(() => reply.promise);
    await flow.access.verify('123456');

    const saving = flow.access.savePassword('password');
    await vi.waitFor(() => expect(flow.setSessionIfUnchanged).toHaveBeenCalledOnce());
    const cleanup = flow.access.dispose();
    flow.ordinarySessionState.current = session('target');
    reply.resolve({ changed: false, data: { session: session('target') }, error: null });

    expect(await saving).toMatchObject({ ok: false, canRetryPassword: false });
    await cleanup;
    expect(flow.clearOrdinarySession).toHaveBeenCalledOnce();
  });

  it('restores the open account when the flow closes during Switch', async () => {
    const flow = controller({ ordinarySession: session('other') });
    await flow.access.verify('123456');
    await flow.access.savePassword('password');
    const reply = deferred<{
      changed: false;
      data: { session: any };
      error: null;
    }>();
    flow.setSessionIfUnchanged.mockImplementationOnce(() => reply.promise);

    const switching = flow.access.switchAccount();
    await vi.waitFor(() => expect(flow.setSessionIfUnchanged).toHaveBeenCalledOnce());
    const cleanup = flow.access.dispose();
    flow.ordinarySessionState.current = session('target');
    reply.resolve({ changed: false, data: { session: session('target') }, error: null });

    expect((await switching).ok).toBe(false);
    await cleanup;
    expect(flow.setSession).toHaveBeenCalledWith({
      access_token: 'access-other',
      refresh_token: 'refresh-other',
    });
  });

  it('does not roll back over a newer open account', async () => {
    for (const newerSession of [
      session('newer'),
      {
        ...session('target'),
        access_token: 'access-newer-target',
        refresh_token: 'refresh-newer-target',
      },
    ]) {
      for (const kind of ['automatic', 'switch'] as const) {
        const flow = controller({ ordinarySession: kind === 'switch' ? session('other') : null });
        await flow.access.verify('123456');
        const reply = deferred<{
          changed: false;
          data: { session: any };
          error: null;
        }>();
        flow.setSessionIfUnchanged.mockImplementationOnce(() => reply.promise);
        const action =
          kind === 'switch'
            ? (await flow.access.savePassword('password'), flow.access.switchAccount())
            : flow.access.savePassword('password');
        await vi.waitFor(() => expect(flow.setSessionIfUnchanged).toHaveBeenCalledOnce());
        const cleanup = flow.access.dispose();
        flow.ordinarySessionState.current = newerSession;
        reply.resolve({ changed: false, data: { session: session('target') }, error: null });

        expect((await action).ok).toBe(false);
        await cleanup;
        expect(flow.ordinarySessionState.current).toBe(newerSession);
        expect(flow.clearOrdinarySession).not.toHaveBeenCalled();
        expect(flow.setSession).not.toHaveBeenCalled();
      }
    }
  });

  it('accepts the existing password and still ends other recovery sessions', async () => {
    const flow = controller({
      ordinarySession: session('target'),
      updateError: { code: 'same_password', status: 422 },
    });
    await flow.access.verify('123456');

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({
      ok: true,
      data: { relationship: 'same', passwordStatus: 'already-set' },
    });
    expect(flow.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(flow.setSession).toHaveBeenCalledOnce();
  });

  it('replaces a same-user session present before other recovery sessions end', async () => {
    const target = lineageSession('target', 'temporary', 'temporary-session');
    const beforeOtherSessionSignOut = lineageSession(
      'target',
      'ordinary-before-sign-out',
      'ordinary-before-sign-out',
    );
    const flow = controller({ target });
    await flow.access.verify('123456');
    flow.updateUser.mockImplementationOnce(async () => {
      flow.ordinarySessionState.current = beforeOtherSessionSignOut;
      return { error: { code: 'same_password', status: 422 } };
    });

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({
      ok: true,
      data: {
        relationship: 'same',
        passwordStatus: 'already-set',
        handedToOrdinaryClient: true,
      },
    });
    expect(flow.setSessionIfUnchanged).toHaveBeenCalledWith(beforeOtherSessionSignOut, {
      access_token: target.access_token,
      refresh_token: target.refresh_token,
    });
  });

  it('preserves a fresh same-user session created after other recovery sessions end', async () => {
    const target = lineageSession('target', 'temporary', 'temporary-session');
    const beforeOtherSessionSignOut = lineageSession(
      'target',
      'ordinary-before-sign-out',
      'ordinary-before-sign-out',
    );
    const afterOtherSessionSignOut = lineageSession(
      'target',
      'ordinary-after-sign-out',
      'ordinary-after-sign-out',
    );
    const flow = controller({ target });
    await flow.access.verify('123456');
    flow.updateUser.mockImplementationOnce(async () => {
      flow.ordinarySessionState.current = beforeOtherSessionSignOut;
      return { error: { code: 'same_password', status: 422 } };
    });
    flow.signOut.mockImplementation(async (options?: { scope?: string }) => {
      if (options?.scope === 'others') {
        flow.ordinarySessionState.current = afterOtherSessionSignOut;
      }
      return { error: null };
    });

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({
      ok: true,
      data: {
        relationship: 'same',
        passwordStatus: 'already-set',
        handedToOrdinaryClient: false,
      },
    });
    expect(flow.setSessionIfUnchanged).not.toHaveBeenCalled();
    expect(flow.clearOrdinarySession).not.toHaveBeenCalled();
    expect(flow.ordinarySessionState.current).toBe(afterOtherSessionSignOut);
  });

  it('clears a stale same-account session if final handoff fails', async () => {
    const flow = controller({ ordinarySession: session('target') });
    flow.setSession.mockResolvedValueOnce({ error: new Error('storage unavailable') });
    await flow.access.verify('123456');

    const result = await flow.access.savePassword('password');

    expect(result).toMatchObject({ ok: false, canRetryPassword: false });
    expect(flow.clearOrdinarySession).toHaveBeenCalledOnce();
    expect(flow.updateUser).toHaveBeenCalledOnce();
  });
});
