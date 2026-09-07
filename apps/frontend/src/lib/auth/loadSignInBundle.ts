import type * as SignInBundleModule from './signInBundle';

/**
 * Fetch everything sign-in, once per page load however many times it is asked
 * for.
 *
 * This is the only place that names `lib/auth/signInBundle.ts`, which is what
 * keeps sign-in in one download instead of several overlapping ones
 * ([#1976](https://github.com/alethical-org/alethical/issues/1976)). It is tiny
 * and every page carries it; what it fetches is about 260,000 minified bytes and
 * most readers never ask for it.
 *
 * `lib/auth/signInWorkPending.ts` decides whether to ask at startup.
 */

type SignInBundle = typeof SignInBundleModule;

let pending: Promise<SignInBundle> | null = null;
const requestListeners = new Set<() => void>();

/** Observe a later sign-in press without fetching the client on public visits. */
export function onSignInBundleRequested(listener: () => void): () => void {
  requestListeners.add(listener);
  if (pending) listener();
  return () => {
    requestListeners.delete(listener);
  };
}

export function loadSignInBundle(): Promise<SignInBundle> {
  if (!pending) {
    pending = import('./signInBundle');
    // Register the session observer before the caller can finish signing in.
    // Set pending first so an observer can safely request this same promise.
    requestListeners.forEach((listener) => listener());
  }
  return pending;
}
