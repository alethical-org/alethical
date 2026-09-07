import { Platform } from 'react-native';

import { hasStoredAuthSession } from '../supabaseConfig';
import { parseAuthError } from '../signIn';
import { pendingSignInRequest } from '../trackIntent';
import { requestedSignInState } from './linkSession';

/**
 * Whether this page load has any sign-in work to do at all.
 *
 * The sign-in client and the sign-in screens are ~260,000 minified bytes and a
 * reader who is not signed in and is not signing in never touches either
 * ([#1976](https://github.com/alethical-org/alethical/issues/1976)), so they are
 * fetched when this says so and not with every page. One question in one place,
 * because 2 copies of it would let the client load without its screens or the
 * screens load without their client.
 *
 * False has to be certain, and each of the 4 things it rules out is a way sign-in
 * work can start without anyone pressing anything:
 *
 * - **A session is saved in this browser**, so it needs restoring, its account
 *   needs checking, and a check can fail (a deactivated account, an unverified
 *   provider email) with a message a reader has to see.
 * - **This address is a sign-in return.** A completed sign-in comes back as
 *   values on the address we asked Google to return to, and only the sign-in
 *   client can turn them into a session.
 * - **A sign-in was in progress when we left.** The request that started it is
 *   stashed before the redirect, and it carries what the reader was doing, so a
 *   held Track action finishes and the page scrolls back where it was.
 * - **A link asked for a particular sign-in screen** (create, recover, sign in),
 *   either stashed or named in the address.
 *
 * Read, never consumed: the provider's own reader clears the stash and rewrites
 * the address, and doing that here would answer the question by destroying it.
 */
export function signInWorkPendingOnLoad(): boolean {
  // Only the web build downloads its code in pieces. A native build holds one
  // bundle, so asking would cost a storage read for nothing.
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  return (
    hasStoredAuthSession() ||
    addressCarriesSignInReturn() ||
    stashedSignInInProgress() ||
    addressAsksForASignInScreen()
  );
}

/**
 * Whether the address carries a sign-in return: a completed sign-in, a
 * password-recovery or confirmation link, or a failure Google sent back.
 *
 * Parameter NAMES only. Nothing here reads, keeps, returns or records a value,
 * because a real callback's values are the session itself
 * (`AGENTS.md` § Hard lines). A name we also use for something else would arm
 * sign-in on a page that does not need it, which costs a fetch and misleads
 * nobody, so the list stays generous rather than exact.
 */
function addressCarriesSignInReturn(): boolean {
  const callbackNames = ['code', 'access_token', 'refresh_token', 'token_hash', 'token', 'type'];
  for (const raw of [window.location.search, window.location.hash]) {
    const names = new URLSearchParams(raw.replace(/^[?#]/, ''));
    if (callbackNames.some((name) => names.has(name))) return true;
  }
  return Boolean(parseAuthError(window.location.search, window.location.hash));
}

/** Whether a sign-in was under way when this browser last left the site. */
function stashedSignInInProgress(): boolean {
  try {
    return pendingSignInRequest(window.sessionStorage.getItem(PENDING_SIGN_IN_KEY)) !== null;
  } catch {
    // A browser that refuses storage cannot have stashed anything.
    return false;
  }
}

/** Whether a link asked for the create, recover, or sign-in screen by name. */
function addressAsksForASignInScreen(): boolean {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(REQUESTED_SCREEN_KEY);
  } catch {
    // The address's own fragment still answers below.
  }
  return requestedSignInState(stored, window.location.hash).screen !== undefined;
}

/** Where a sign-in request waits while the browser is away at Google. */
export const PENDING_SIGN_IN_KEY = 'alethical.pendingSignIn';

/** Where a link's requested sign-in screen waits. */
export const REQUESTED_SCREEN_KEY = 'alethical.openSignIn';
