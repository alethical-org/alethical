import type { Session, User } from '@supabase/auth-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

class SharedWebLocks {
  private tails = new Map<string, Promise<void>>();

  async request<T>(
    name: string,
    _options: LockOptions,
    callback: (lock: Lock) => Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.tails.set(name, tail);

    await previous;
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
    }
  }

  async query(): Promise<LockManagerSnapshot> {
    return { held: [], pending: [] };
  }
}

class SharedStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function base64Url(value: object): string {
  return globalThis
    .btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function accessToken(userId: string, sessionId: string, label: string, expiresAt: number): string {
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
    sub: userId,
    session_id: sessionId,
    exp: expiresAt,
  })}.${base64Url({ label })}`;
}

function user(id: string): User {
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${id}@example.com`,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
  } as User;
}

function session(
  userId: string,
  sessionId: string,
  label: string,
  expiresAt = Math.floor(Date.now() / 1000) + 60 * 60,
): Session {
  return {
    access_token: accessToken(userId, sessionId, label, expiresAt),
    refresh_token: `refresh-${label}`,
    expires_in: expiresAt - Math.floor(Date.now() / 1000),
    expires_at: expiresAt,
    token_type: 'bearer',
    user: user(userId),
  };
}

function bearerToken(init?: RequestInit): string | null {
  const authorization = new Headers(init?.headers).get('Authorization');
  return authorization?.replace(/^Bearer /, '') ?? null;
}

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

type WebAuthModule = typeof import('../supabase.web');
type WebAuthClient = WebAuthModule['supabase']['auth'];

let authModule: WebAuthModule;

beforeAll(async () => {
  vi.stubGlobal('navigator', { locks: new SharedWebLocks() });
  authModule = await import('../supabase.web');
  await authModule.supabase.auth.initialize();
});

function createPair(
  storage: SharedStorage,
  fetcher: typeof fetch,
): { first: WebAuthClient; second: WebAuthClient; storageKey: string } {
  const template = authModule.supabase.auth as unknown as {
    constructor: new (settings: Record<string, unknown>) => WebAuthClient;
    storageKey: string;
    url: string;
    headers: Record<string, string>;
  };
  const settings = {
    url: template.url,
    headers: template.headers,
    storageKey: template.storageKey,
    storage,
    fetch: fetcher,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    lock: authModule.webAuthLock,
    lockAcquireTimeout: -1,
    skipAutoInitialize: true,
  };
  return {
    first: new template.constructor(settings),
    second: new template.constructor(settings),
    storageKey: template.storageKey,
  };
}

async function initializeBoth(first: WebAuthClient, second: WebAuthClient): Promise<void> {
  await Promise.all([first.initialize(), second.initialize()]);
}

function savedSession(storage: SharedStorage, storageKey: string): Session | null {
  const raw = storage.getItem(storageKey);
  return raw ? (JSON.parse(raw) as Session) : null;
}

function userFetch(
  sessions: Session[],
  gates = new Map<string, Deferred<void>>(),
  calls: string[] = [],
): typeof fetch {
  const usersByToken = new Map(sessions.map((value) => [value.access_token, value.user]));
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const token = bearerToken(init);
    if (!token || !usersByToken.has(token)) {
      return new Response(JSON.stringify({ message: 'Unknown test token' }), { status: 401 });
    }
    calls.push(token);
    const gate = gates.get(token);
    if (gate) await gate.promise;
    return jsonResponse(usersByToken.get(token)!);
  }) as typeof fetch;
}

describe('the web session handoff lock', () => {
  it('waits without a timeout for the shared browser lock', () => {
    const client = authModule.supabase.auth as unknown as {
      lock: unknown;
      lockAcquireTimeout: number;
    };

    expect(client.lock).toBe(authModule.webAuthLock);
    expect(client.lockAcquireTimeout).toBe(-1);
  });

  it('refuses a delayed handoff when a newer sign-in gets the lock first', async () => {
    const original = session('person', 'original-session', 'original');
    const delayedTarget = session('person', 'delayed-session', 'delayed');
    const newer = session('person', 'newer-session', 'newer');
    const storage = new SharedStorage();
    const newerGate = deferred<void>();
    const calls: string[] = [];
    const fetcher = userFetch(
      [delayedTarget, newer],
      new Map([[newer.access_token, newerGate]]),
      calls,
    );
    const { first, second, storageKey } = createPair(storage, fetcher);
    storage.setItem(storageKey, JSON.stringify(original));
    await initializeBoth(first, second);

    const newerWrite = second.setSession({
      access_token: newer.access_token,
      refresh_token: newer.refresh_token,
    });
    await vi.waitFor(() => expect(calls).toEqual([newer.access_token]));

    const delayedWrite = first.setSessionIfUnchanged(original, {
      access_token: delayedTarget.access_token,
      refresh_token: delayedTarget.refresh_token,
    });
    await Promise.resolve();
    expect(calls).toEqual([newer.access_token]);

    newerGate.resolve();
    await expect(newerWrite).resolves.toMatchObject({ error: null });
    await expect(delayedWrite).resolves.toMatchObject({
      changed: true,
      data: { session: { access_token: newer.access_token } },
      error: null,
    });
    expect(calls).toEqual([newer.access_token]);
    expect(savedSession(storage, storageKey)?.access_token).toBe(newer.access_token);
  });

  it('lets a newer sign-in finish last when the delayed handoff gets the lock first', async () => {
    const original = session('person', 'original-session', 'original');
    const delayedTarget = session('person', 'delayed-session', 'delayed');
    const newer = session('person', 'newer-session', 'newer');
    const storage = new SharedStorage();
    const delayedGate = deferred<void>();
    const calls: string[] = [];
    const fetcher = userFetch(
      [delayedTarget, newer],
      new Map([[delayedTarget.access_token, delayedGate]]),
      calls,
    );
    const { first, second, storageKey } = createPair(storage, fetcher);
    storage.setItem(storageKey, JSON.stringify(original));
    await initializeBoth(first, second);

    const delayedWrite = first.setSessionIfUnchanged(original, {
      access_token: delayedTarget.access_token,
      refresh_token: delayedTarget.refresh_token,
    });
    await vi.waitFor(() => expect(calls).toEqual([delayedTarget.access_token]));

    const newerWrite = second.setSession({
      access_token: newer.access_token,
      refresh_token: newer.refresh_token,
    });
    await Promise.resolve();
    expect(calls).toEqual([delayedTarget.access_token]);

    delayedGate.resolve();
    await expect(delayedWrite).resolves.toMatchObject({
      changed: false,
      data: { session: { access_token: delayedTarget.access_token } },
      error: null,
    });
    await expect(newerWrite).resolves.toMatchObject({ error: null });
    expect(calls).toEqual([delayedTarget.access_token, newer.access_token]);
    expect(savedSession(storage, storageKey)?.access_token).toBe(newer.access_token);
  });

  it('preserves a newer sign-in that gets the lock before an older sign-out', async () => {
    const opening = session('person-a', 'opening-session', 'opening');
    const newer = session('person-b', 'newer-session', 'newer');
    const storage = new SharedStorage();
    const newerGate = deferred<void>();
    const calls: string[] = [];
    const fetcher = userFetch([newer], new Map([[newer.access_token, newerGate]]), calls);
    const { first, second, storageKey } = createPair(storage, fetcher);
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);

    const newerWrite = second.setSession({
      access_token: newer.access_token,
      refresh_token: newer.refresh_token,
    });
    await vi.waitFor(() => expect(calls).toEqual([newer.access_token]));
    const olderSignOut = first.signOutSessionIfUnchanged(opening);

    newerGate.resolve();
    await expect(newerWrite).resolves.toMatchObject({ error: null });
    await expect(olderSignOut).resolves.toEqual({ changed: true, error: null });
    expect(savedSession(storage, storageKey)?.access_token).toBe(newer.access_token);
  });

  it('preserves a fresh sign-in with a new provider session identity', async () => {
    const opening = session('person', 'opening-session', 'opening');
    const newer = session('person', 'newer-session', 'newer');
    const storage = new SharedStorage();
    const { first, second, storageKey } = createPair(storage, userFetch([newer]));
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);

    await second.setSession({
      access_token: newer.access_token,
      refresh_token: newer.refresh_token,
    });

    await expect(first.clearSessionIfUnchanged(opening)).resolves.toBe(false);
    expect(savedSession(storage, storageKey)?.access_token).toBe(newer.access_token);
  });

  it('clears a refreshed continuation of the same provider session', async () => {
    const opening = session('person', 'same-session', 'opening');
    const refreshed = session('person', 'same-session', 'refreshed');
    const storage = new SharedStorage();
    const { first, second, storageKey } = createPair(storage, userFetch([refreshed]));
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);

    await second.setSession({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    });

    await expect(first.clearSessionIfUnchanged(opening)).resolves.toBe(true);
    expect(savedSession(storage, storageKey)).toBeNull();
  });

  it('does not report the original session as a committed target when the write fails first', async () => {
    const original = session('person-b', 'original-session', 'original');
    const target = session('person-a', 'target-session', 'target');
    const storage = new SharedStorage();
    const { first, second, storageKey } = createPair(storage, userFetch([target]));
    storage.setItem(storageKey, JSON.stringify(original));
    await initializeBoth(first, second);
    vi.spyOn(first as any, '_setSession').mockRejectedValueOnce(new Error('before write'));

    await expect(
      first.setSessionIfUnchanged(original, {
        access_token: target.access_token,
        refresh_token: target.refresh_token,
      }),
    ).resolves.toMatchObject({
      changed: false,
      data: { session: null },
      error: expect.any(Error),
    });
    expect(savedSession(storage, storageKey)?.access_token).toBe(original.access_token);
  });

  it('reports the committed target when notification fails after the write', async () => {
    const original = session('person-b', 'original-session', 'original');
    const target = session('person-a', 'target-session', 'target');
    const storage = new SharedStorage();
    const { first, second, storageKey } = createPair(storage, userFetch([target]));
    storage.setItem(storageKey, JSON.stringify(original));
    await initializeBoth(first, second);
    vi.spyOn(first as any, '_setSession').mockImplementationOnce(async () => {
      storage.setItem(storageKey, JSON.stringify(target));
      throw new Error('after write');
    });

    await expect(
      first.setSessionIfUnchanged(original, {
        access_token: target.access_token,
        refresh_token: target.refresh_token,
      }),
    ).resolves.toMatchObject({
      changed: false,
      data: { session: { access_token: target.access_token } },
      error: expect.any(Error),
    });
  });

  it('recognizes a completed clear even when notification throws', async () => {
    const opening = session('person', 'opening-session', 'opening');
    const storage = new SharedStorage();
    const { first, second, storageKey } = createPair(storage, userFetch([]));
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);
    vi.spyOn(first as any, '_removeSession').mockImplementationOnce(async () => {
      storage.removeItem(storageKey);
      throw new Error('notification failed');
    });

    await expect(first.clearSessionIfUnchanged(opening)).resolves.toBe(true);
    expect(savedSession(storage, storageKey)).toBeNull();
  });

  it('does not claim a clear succeeded when removal fails and storage cannot be reread', async () => {
    const opening = session('person', 'opening-session', 'opening');
    const storage = new SharedStorage();
    const { first, second, storageKey } = createPair(storage, userFetch([]));
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);
    const read = storage.getItem.bind(storage);
    let reads = 0;
    vi.spyOn(storage, 'getItem').mockImplementation((key) => {
      reads += 1;
      if (reads > 1) throw new Error('storage unavailable');
      return read(key);
    });
    vi.spyOn(first as any, '_removeSession').mockRejectedValueOnce(new Error('remove failed'));

    await expect(first.clearSessionIfUnchanged(opening)).resolves.toBe(false);
  });

  it('blocks a password change after another account signs in', async () => {
    const opening = session('opening-person', 'opening-session', 'opening');
    const newer = session('newer-person', 'newer-session', 'newer');
    const storage = new SharedStorage();
    const passwordRequests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        passwordRequests.push(init);
        return jsonResponse(user('opening-person'));
      }
      const token = bearerToken(init);
      if (token === newer.access_token) return jsonResponse(newer.user);
      return new Response(JSON.stringify({ message: 'Unknown test token' }), { status: 401 });
    }) as typeof fetch;
    const { first, second, storageKey } = createPair(storage, fetcher);
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);
    const boundPasswordClient = first.passwordClientForSession(opening);

    await second.setSession({
      access_token: newer.access_token,
      refresh_token: newer.refresh_token,
    });
    const result = await boundPasswordClient.updateUser({ password: '12345678' });

    expect(result.error).toMatchObject({ code: 'session_changed', status: 409 });
    expect(passwordRequests).toHaveLength(0);
    expect(savedSession(storage, storageKey)?.access_token).toBe(newer.access_token);
  });

  it('allows a password change after the opening session refreshes', async () => {
    const opening = session('person', 'same-session', 'opening');
    const refreshed = session('person', 'same-session', 'refreshed');
    const updatedUser = { ...refreshed.user, updated_at: '2026-08-21T00:00:00.000Z' } as User;
    const storage = new SharedStorage();
    const passwordRequests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const token = bearerToken(init);
      if (init?.method === 'PUT') {
        passwordRequests.push(init);
        return jsonResponse(updatedUser);
      }
      if (token === refreshed.access_token) return jsonResponse(refreshed.user);
      return new Response(JSON.stringify({ message: 'Unknown test token' }), { status: 401 });
    }) as typeof fetch;
    const { first, second, storageKey } = createPair(storage, fetcher);
    storage.setItem(storageKey, JSON.stringify(opening));
    await initializeBoth(first, second);
    const boundPasswordClient = first.passwordClientForSession(opening);

    await second.setSession({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    });
    const result = await boundPasswordClient.updateUser({ password: '12345678' });

    expect(result.error).toBeNull();
    expect(passwordRequests).toHaveLength(1);
    expect(savedSession(storage, storageKey)?.access_token).toBe(refreshed.access_token);
    expect(savedSession(storage, storageKey)?.user.updated_at).toBe(updatedUser.updated_at);
  });

  it('returns the rotated session that was saved for expired input tokens', async () => {
    const expired = session(
      'person',
      'same-session',
      'expired',
      Math.floor(Date.now() / 1000) - 60,
    );
    const rotated = session('person', 'same-session', 'rotated');
    const storage = new SharedStorage();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/token?grant_type=refresh_token')) return jsonResponse(rotated);
      return new Response(JSON.stringify({ message: 'Unexpected test request' }), { status: 500 });
    }) as typeof fetch;
    const { first, second, storageKey } = createPair(storage, fetcher);
    await initializeBoth(first, second);

    const result = await first.setSessionIfUnchanged(null, {
      access_token: expired.access_token,
      refresh_token: expired.refresh_token,
    });

    expect(result).toMatchObject({
      changed: false,
      data: {
        session: { access_token: rotated.access_token, refresh_token: rotated.refresh_token },
      },
      error: null,
    });
    expect(savedSession(storage, storageKey)?.access_token).toBe(rotated.access_token);
  });
});
