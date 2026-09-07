/**
 * Which sign-in service this build talks to, and where a signed-in session is
 * saved, with none of the sign-in client behind it.
 *
 * This sits apart from `lib/supabase.ts` and `lib/supabase.web.ts` because both
 * of those construct the client, and constructing it is what pulls
 * `@supabase/auth-js` — 122,714 minified bytes — into whatever download reaches
 * them. Reading a build's addresses, and asking whether this browser has a
 * session saved at all, needs none of that
 * ([#1976](https://github.com/alethical-org/alethical/issues/1976)). Both client
 * files read their addresses from here, so a build cannot end up pointed at two
 * different services.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/** Whether this build was given a sign-in service to talk to at all. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

/**
 * The service's address and public key. The local fallbacks keep a build without
 * them from throwing while `isSupabaseConfigured` reports the truth to callers.
 */
export const supabaseAuthConfig = {
  url: supabaseUrl || 'http://localhost:54321',
  publishableKey: supabasePublishableKey || 'missing-publishable-key',
} as const;

/** The service's address with a trailing slash, which the auth client builds on. */
export const supabaseAuthBaseUrl = new URL(`${supabaseAuthConfig.url.replace(/\/+$/, '')}/`);

/** The one key a saved session is stored under, on the browser and on a device. */
export const supabaseAuthStorageKey = `sb-${supabaseAuthBaseUrl.hostname.split('.')[0]}-auth-token`;

/**
 * Whether this browser has a signed-in session saved.
 *
 * True is not a promise that the session is valid — only the sign-in service can
 * say that, and a saved session can be expired, revoked, or for a deactivated
 * account. False, though, is certain: nothing is signed in here, so nothing needs
 * restoring and the sign-in client is never fetched. That is the whole point of
 * asking, and it is why the answer is a key lookup rather than a session read.
 *
 * A browser that refuses storage (a private window, blocked site data) answers
 * false, which lands a reader in the same place a real signed-out reader lands.
 */
export function hasStoredAuthSession(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(supabaseAuthStorageKey) !== null;
  } catch {
    return false;
  }
}
