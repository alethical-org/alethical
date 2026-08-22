import { AuthClient } from '@supabase/auth-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordSignInController } from '../passwordSignInFlow';
import { resetProviderSessionRejectionsForTests } from '../providerSessionAcceptance';

afterEach(() => resetProviderSessionRejectionsForTests());

function client(methods: Record<string, unknown>) {
  return methods as unknown as InstanceType<typeof AuthClient>;
}

function session(id: string) {
  return {
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
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

function setup({ ordinarySession = null }: { ordinarySession?: any } = {}) {
  const target = session('target');
  const ordinaryState = { current: ordinarySession };
  const signInWithPassword = vi.fn(async () => ({
    data: { user: target.user, session: target },
    error: null,
  }));
  const signOut = vi.fn(async () => ({ error: null }));
  const getSession = vi.fn(async () => ({
    data: { session: ordinaryState.current },
    error: null,
  }));
  const setSession = vi.fn(async (_tokens?: { access_token: string; refresh_token: string }) => {
    ordinaryState.current = target;
    return { error: null };
  });
  const clearOrdinarySession = vi.fn(() => {
    ordinaryState.current = null;
  });
  const setSessionIfUnchanged = vi.fn(
    async (expected: any, tokens: { access_token: string; refresh_token: string }) => {
      const current = ordinaryState.current;
      const unchanged = expected
        ? current?.access_token === expected.access_token &&
          current?.refresh_token === expected.refresh_token &&
          current?.user.id === expected.user.id
        : current === null;
      if (!unchanged) return { changed: true, data: { session: current }, error: null };
      const result = await setSession(tokens);
      return { changed: false, data: { session: ordinaryState.current }, error: result.error };
    },
  );
  const clearSessionIfUnchanged = vi.fn(async (expected: any) => {
    if (
      ordinaryState.current?.access_token !== expected.access_token ||
      ordinaryState.current?.refresh_token !== expected.refresh_token ||
      ordinaryState.current?.user.id !== expected.user.id
    ) {
      return false;
    }
    clearOrdinarySession();
    return true;
  });
  const validate = vi.fn(async () => ({
    ok: true as const,
    data: {
      id: 'target',
      name: 'Target',
      email: 'target@example.com',
      signInMethods: { google: false, password: true },
    },
  }));
  const access = new PasswordSignInController(
    client({ signInWithPassword, signOut }),
    { getSession, setSessionIfUnchanged, clearSessionIfUnchanged },
    validate,
  );
  return {
    access,
    clearOrdinarySession,
    getSession,
    ordinaryState,
    setSession,
    setSessionIfUnchanged,
    signInWithPassword,
    signOut,
    target,
    validate,
  };
}

describe('ordinary password sign-in lifetime', () => {
  it('checks the password outside the saved browser session, then hands off once', async () => {
    const flow = setup();

    const result = await flow.access.signIn(' Target@Example.com ', 'password');

    expect(result.ok).toBe(true);
    expect(flow.signInWithPassword).toHaveBeenCalledWith({
      email: 'target@example.com',
      password: 'password',
    });
    expect(flow.validate).toHaveBeenCalledWith(flow.target);
    expect(flow.setSession).toHaveBeenCalledWith({
      access_token: flow.target.access_token,
      refresh_token: flow.target.refresh_token,
    });
    expect(flow.signOut).not.toHaveBeenCalled();
  });

  it('preserves an account that opened while the password was being checked', async () => {
    const newer = session('newer');
    const flow = setup({ ordinarySession: newer });

    const result = await flow.access.signIn('target@example.com', 'password');

    expect(result.ok).toBe(true);
    expect(flow.setSession).not.toHaveBeenCalled();
    expect(flow.ordinaryState.current).toBe(newer);
    expect(flow.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a closed handoff cannot clear a newer account', async () => {
    const flow = setup();
    const handoff = deferred<{
      changed: false;
      data: { session: any };
      error: null;
    }>();
    flow.setSessionIfUnchanged.mockImplementationOnce(() => handoff.promise);

    const pending = flow.access.signIn('target@example.com', 'password');
    await vi.waitFor(() => expect(flow.setSessionIfUnchanged).toHaveBeenCalledOnce());
    const cleanup = flow.access.dispose();
    const newer = session('newer');
    flow.ordinaryState.current = newer;
    handoff.resolve({ changed: false, data: { session: flow.target }, error: null });

    const result = await pending;
    await cleanup;

    expect(result.ok).toBe(false);
    expect(flow.ordinaryState.current).toBe(newer);
    expect(flow.clearOrdinarySession).not.toHaveBeenCalled();
  });

  it('a closed handoff removes only the exact session it wrote', async () => {
    const flow = setup();
    const handoff = deferred<{
      changed: false;
      data: { session: any };
      error: null;
    }>();
    flow.setSessionIfUnchanged.mockImplementationOnce(() => handoff.promise);

    const pending = flow.access.signIn('target@example.com', 'password');
    await vi.waitFor(() => expect(flow.setSessionIfUnchanged).toHaveBeenCalledOnce());
    const cleanup = flow.access.dispose();
    flow.ordinaryState.current = flow.target;
    handoff.resolve({ changed: false, data: { session: flow.target }, error: null });

    await pending;
    await cleanup;

    expect(flow.clearOrdinarySession).toHaveBeenCalledOnce();
    expect(flow.ordinaryState.current).toBeNull();
  });

  it('closing during the final saved-session check removes the session it wrote', async () => {
    const flow = setup();
    const finalRead = deferred<{ data: { session: any }; error: null }>();
    flow.getSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockImplementationOnce(() => finalRead.promise);

    const pending = flow.access.signIn('target@example.com', 'password');
    await vi.waitFor(() => expect(flow.getSession).toHaveBeenCalledTimes(2));
    expect(flow.ordinaryState.current).toBe(flow.target);
    const cleanup = flow.access.dispose();
    finalRead.resolve({ data: { session: flow.target }, error: null });

    const result = await pending;
    await cleanup;

    expect(result.ok).toBe(false);
    expect(flow.clearOrdinarySession).toHaveBeenCalledOnce();
    expect(flow.ordinaryState.current).toBeNull();
  });
});
