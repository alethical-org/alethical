import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import type { Session, UserAttributes } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { clearStoredProviderSession } from './auth/sessionSafety';
import {
  sameProviderSessionLineage,
  sessionMatchesProviderTokenLineage,
} from './auth/providerSessionAcceptance';

WebBrowser.maybeCompleteAuthSession();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabaseAuthConfig = {
  url: supabaseUrl || 'http://localhost:54321',
  publishableKey: supabasePublishableKey || 'missing-publishable-key',
} as const;
const authStorageKey = `sb-${new URL(supabaseAuthConfig.url).hostname.split('.')[0]}-auth-token`;

/** Remove a provider session that Alethical has already proved is unsafe. */
async function clearStoredSupabaseSessionWithoutCheck() {
  if (Platform.OS === 'web') {
    try {
      await clearStoredProviderSession(window.localStorage, authStorageKey);
    } catch {
      // If browser storage is unavailable, no durable browser session can survive.
    }
    return;
  }
  try {
    await clearStoredProviderSession(AsyncStorage, authStorageKey);
  } catch {
    // If device storage is unavailable, no durable device session can survive.
  }
}

export const supabase = createClient(supabaseAuthConfig.url, supabaseAuthConfig.publishableKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    storageKey: authStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
    lock: processLock,
  },
});

export interface ConditionalSessionWrite {
  changed: boolean;
  data: { session: Session | null };
  error: unknown | null;
}

type AuthClientInternals = {
  _setSession(tokens: {
    access_token: string;
    refresh_token: string;
  }): Promise<{ data: { session: Session | null }; error: unknown | null }>;
  _removeSession(): Promise<void>;
  _signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>;
  _updateUser(attributes: UserAttributes): Promise<{ error: unknown | null }>;
  _reauthenticate(): Promise<{ error: unknown | null }>;
};

export interface BoundPasswordAuthClient {
  updateUser(attributes: UserAttributes): Promise<{ error: unknown | null }>;
  reauthenticate(): Promise<{ error: unknown | null }>;
}

const sessionChangedError = {
  code: 'session_changed',
  status: 409,
  message: 'The signed-in account changed',
};

async function readStoredSession(): Promise<{ session: Session | null; error: unknown | null }> {
  try {
    const raw =
      Platform.OS === 'web'
        ? window.localStorage.getItem(authStorageKey)
        : await AsyncStorage.getItem(authStorageKey);
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

export function setOrdinarySessionIfUnchanged(
  expected: Session | null,
  tokens: { access_token: string; refresh_token: string },
): Promise<ConditionalSessionWrite> {
  return supabase.auth.initialize().then(() =>
    processLock(`lock:${authStorageKey}`, -1, async () => {
      const current = await readStoredSession();
      if (current.error) return { changed: false, data: { session: null }, error: current.error };
      const unchanged = expected
        ? sameProviderSessionLineage(current.session, expected)
        : current.session === null;
      if (!unchanged) return { changed: true, data: { session: current.session }, error: null };
      const internal = supabase.auth as unknown as AuthClientInternals;
      try {
        const written = await internal._setSession(tokens);
        return { changed: false, data: written.data, error: written.error };
      } catch (error) {
        const saved = await readStoredSession();
        const committed =
          saved.session && sessionMatchesProviderTokenLineage(saved.session, tokens)
            ? saved.session
            : null;
        return { changed: false, data: { session: committed }, error };
      }
    }),
  );
}

export function clearOrdinarySessionIfUnchanged(expected: Session): Promise<boolean> {
  return supabase.auth.initialize().then(() =>
    processLock(`lock:${authStorageKey}`, -1, async () => {
      const current = await readStoredSession();
      if (current.error || !sameProviderSessionLineage(current.session, expected)) return false;
      try {
        await (supabase.auth as unknown as AuthClientInternals)._removeSession();
        return true;
      } catch {
        const after = await readStoredSession();
        return !after.error && !sameProviderSessionLineage(after.session, expected);
      }
    }),
  );
}

export function signOutOrdinarySessionIfUnchanged(
  expected: Session,
): Promise<{ changed: boolean; error: unknown | null }> {
  return supabase.auth.initialize().then(() =>
    processLock(`lock:${authStorageKey}`, -1, async () => {
      const current = await readStoredSession();
      if (current.error) return { changed: false, error: current.error };
      if (!sameProviderSessionLineage(current.session, expected)) {
        return { changed: true, error: null };
      }
      try {
        return {
          changed: false,
          ...(await (supabase.auth as unknown as AuthClientInternals)._signOut({
            scope: 'local',
          })),
        };
      } catch (error) {
        return { changed: false, error };
      }
    }),
  );
}

export function passwordClientForOrdinarySession(initial: Session): BoundPasswordAuthClient {
  let expected = initial;
  const run = async (
    work: () => Promise<{ error: unknown | null }>,
  ): Promise<{ error: unknown | null }> =>
    supabase.auth.initialize().then(() =>
      processLock(`lock:${authStorageKey}`, -1, async () => {
        const current = await readStoredSession();
        if (current.error) return { error: current.error };
        if (!sameProviderSessionLineage(current.session, expected)) {
          return { error: sessionChangedError };
        }
        const result = await work();
        const after = await readStoredSession();
        if (!after.error && after.session) expected = after.session;
        return result;
      }),
    );

  const internal = supabase.auth as unknown as AuthClientInternals;
  return {
    updateUser: (attributes) => run(() => internal._updateUser(attributes)),
    reauthenticate: () => run(() => internal._reauthenticate()),
  };
}

export async function clearStoredSupabaseSession(expected?: Session) {
  if (expected) return clearOrdinarySessionIfUnchanged(expected);
  return clearStoredSupabaseSessionWithoutCheck();
}

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
