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
 * `lib/auth/signInWorkPending.ts` decides when to ask.
 */

type SignInBundle = typeof SignInBundleModule;

let pending: Promise<SignInBundle> | null = null;

export function loadSignInBundle(): Promise<SignInBundle> {
  pending ??= import('./signInBundle');
  return pending;
}
