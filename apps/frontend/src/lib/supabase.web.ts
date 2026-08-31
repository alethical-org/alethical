import { AuthClient, navigatorLock, processLock } from '@supabase/auth-js';
import type { Session, UserAttributes } from '@supabase/auth-js';
import { clearStoredProviderSession } from './auth/sessionSafety';
import {
  sameProviderSessionLineage,
  sessionMatchesProviderTokenLineage,
} from './auth/providerSessionAcceptance';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

const clientUrl = supabaseUrl || 'http://localhost:54321';
const clientKey = supabasePublishableKey || 'missing-publishable-key';
const baseUrl = new URL(`${clientUrl.replace(/\/+$/, '')}/`);
const authStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`;

export const supabaseAuthConfig = {
  url: clientUrl,
  publishableKey: clientKey,
} as const;

export interface ConditionalSessionWrite {
  changed: boolean;
  data: { session: Session | null };
  error: unknown | null;
}

type AuthClientInternals = {
  storage: {
    getItem(key: string): string | null | PromiseLike<string | null>;
  };
  storageKey: string;
  _setSession(tokens: {
    access_token: string;
    refresh_token: string;
  }): Promise<{ data: { session: Session | null }; error: unknown | null }>;
  _removeSession(): Promise<void>;
  _signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>;
  _reauthenticate(): Promise<{ error: unknown | null }>;
};

interface StoredSessionResult {
  session: Session | null;
  error: unknown | null;
}

export interface BoundPasswordAuthClient {
  updateUser(attributes: UserAttributes): Promise<{ error: unknown | null }>;
  reauthenticate(): Promise<{ error: unknown | null }>;
}

const sessionChangedError = {
  code: 'session_changed',
  status: 409,
  message: 'The signed-in account changed',
};

export const webAuthLock =
  typeof globalThis.navigator !== 'undefined' && globalThis.navigator.locks
    ? navigatorLock
    : processLock;

class AlethicalWebAuthClient extends AuthClient {
  async setSessionIfUnchanged(
    expected: Session | null,
    tokens: { access_token: string; refresh_token: string },
  ): Promise<ConditionalSessionWrite> {
    await this.initialize();
    return webAuthLock(`lock:${authStorageKey}`, -1, async () => {
      const current = await this.readStoredSession();
      if (current.error) return { changed: false, data: { session: null }, error: current.error };
      if (!sameExpectedSession(current.session, expected)) {
        return { changed: true, data: { session: current.session }, error: null };
      }
      const internal = this as unknown as AuthClientInternals;
      try {
        const written = await internal._setSession(tokens);
        return { changed: false, data: written.data, error: written.error };
      } catch (error) {
        const saved = await this.readStoredSession();
        const committed =
          saved.session && sessionMatchesProviderTokenLineage(saved.session, tokens)
            ? saved.session
            : null;
        return { changed: false, data: { session: committed }, error };
      }
    });
  }

  async clearSessionIfUnchanged(expected: Session): Promise<boolean> {
    await this.initialize();
    return webAuthLock(`lock:${authStorageKey}`, -1, async () => {
      const current = await this.readStoredSession();
      if (current.error || !sameProviderSessionLineage(current.session, expected)) return false;
      const internal = this as unknown as AuthClientInternals;
      try {
        await internal._removeSession();
        return true;
      } catch {
        const after = await this.readStoredSession();
        return !after.error && !sameProviderSessionLineage(after.session, expected);
      }
    });
  }

  async signOutSessionIfUnchanged(
    expected: Session,
  ): Promise<{ changed: boolean; error: unknown | null }> {
    await this.initialize();
    return webAuthLock(`lock:${authStorageKey}`, -1, async () => {
      const current = await this.readStoredSession();
      if (current.error) return { changed: false, error: current.error };
      if (!sameProviderSessionLineage(current.session, expected)) {
        return { changed: true, error: null };
      }
      try {
        return {
          changed: false,
          ...(await (this as unknown as AuthClientInternals)._signOut({ scope: 'local' })),
        };
      } catch (error) {
        return { changed: false, error };
      }
    });
  }

  passwordClientForSession(initial: Session): BoundPasswordAuthClient {
    let expected = initial;
    const run = async (
      work: () => Promise<{ error: unknown | null }>,
    ): Promise<{ error: unknown | null }> => {
      await this.initialize();
      return webAuthLock(`lock:${authStorageKey}`, -1, async () => {
        const current = await this.readStoredSession();
        if (current.error) return { error: current.error };
        if (!sameProviderSessionLineage(current.session, expected)) {
          return { error: sessionChangedError };
        }
        const result = await work();
        const after = await this.readStoredSession();
        if (!after.error && after.session) expected = after.session;
        return result;
      });
    };

    return {
      updateUser: (attributes) => run(() => this._updateUser(attributes)),
      reauthenticate: () => run(() => (this as unknown as AuthClientInternals)._reauthenticate()),
    };
  }

  private async readStoredSession(): Promise<StoredSessionResult> {
    const internal = this as unknown as AuthClientInternals;
    try {
      const raw = await internal.storage.getItem(internal.storageKey);
      if (!raw) return { session: null, error: null };
      const session = JSON.parse(raw) as Session;
      if (
        !session ||
        typeof session.access_token !== 'string' ||
        typeof session.refresh_token !== 'string' ||
        typeof session.user?.id !== 'string'
      ) {
        return { session: null, error: new Error('The saved session is invalid') };
      }
      return { session, error: null };
    } catch (error) {
      return { session: null, error };
    }
  }
}

function sameExpectedSession(current: Session | null, expected: Session | null): boolean {
  return expected ? sameProviderSessionLineage(current, expected) : current === null;
}

export const supabase = {
  auth: new AlethicalWebAuthClient({
    url: new URL('auth/v1', baseUrl).toString(),
    headers: {
      Authorization: `Bearer ${clientKey}`,
      apikey: clientKey,
    },
    storageKey: authStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    lock: webAuthLock,
    lockAcquireTimeout: -1,
  }),
};

export function setOrdinarySessionIfUnchanged(
  expected: Session | null,
  tokens: { access_token: string; refresh_token: string },
) {
  return supabase.auth.setSessionIfUnchanged(expected, tokens);
}

export function clearOrdinarySessionIfUnchanged(expected: Session) {
  return supabase.auth.clearSessionIfUnchanged(expected);
}

export function signOutOrdinarySessionIfUnchanged(expected: Session) {
  return supabase.auth.signOutSessionIfUnchanged(expected);
}

export function passwordClientForOrdinarySession(expected: Session): BoundPasswordAuthClient {
  return supabase.auth.passwordClientForSession(expected);
}

/** Remove a provider session that Alethical has already proved is unsafe. */
export async function clearStoredSupabaseSession(expected?: Session) {
  if (expected) return clearOrdinarySessionIfUnchanged(expected);
  return clearStoredProviderSession(window.localStorage, authStorageKey);
}
