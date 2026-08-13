import type { PublicAuthErrorKind } from './rev9Auth';

interface LocalAuthClient {
  signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>;
  getSession(): Promise<{
    data: { session: unknown | null };
    error: unknown | null;
  }>;
}

export interface SavedSessionStorage {
  removeItem(key: string): void | Promise<void>;
}

export interface VerifiedLocalSignOut {
  signedOut: boolean;
  error: unknown | null;
}

/**
 * The local session is the truth after sign-out. A failed provider request may
 * still have removed the local session, so always read it back before deciding.
 */
export async function signOutLocallyAndVerify(
  auth: LocalAuthClient,
): Promise<VerifiedLocalSignOut> {
  let signOutError: unknown | null = null;
  try {
    ({ error: signOutError } = await auth.signOut({ scope: 'local' }));
  } catch (error) {
    signOutError = error;
  }

  try {
    const restored = await auth.getSession();
    if (!restored.error && !restored.data.session) {
      return { signedOut: true, error: null };
    }
    return { signedOut: false, error: restored.error ?? signOutError };
  } catch (error) {
    return { signedOut: false, error };
  }
}

/**
 * A temporary Alethical API failure cannot prove that the provider identity is
 * unsafe. Keep that provider session available for a later retry, but hide the
 * person's Alethical data until validation succeeds.
 */
export function validationFailureRevokesSession(kind: PublicAuthErrorKind): boolean {
  return kind === 'deactivated' || kind === 'match-failed';
}

/** Remove both durable Supabase browser/device records after an unsafe session. */
export async function clearStoredProviderSession(
  storage: SavedSessionStorage,
  storageKey: string,
): Promise<void> {
  for (const key of [storageKey, `${storageKey}-code-verifier`]) {
    try {
      await storage.removeItem(key);
    } catch {
      // Try every known record even when browser or device storage is unavailable.
    }
  }
}
