import { Platform } from 'react-native';

/**
 * A development-only way to stop the sign-in dialog in its "Connecting" state and
 * leave it there, so somebody can actually look at it.
 *
 * Why this exists. The connecting state lives for the blink before the browser
 * leaves for Google, and a local build has no Supabase keys at all — so pressing
 * the button fails instantly and the state never appears. Two sessions in a row
 * could not see it, could not check what it announces to a screen reader, and
 * worked around it ([#1025](https://github.com/alethical-org/alethical/issues/1025)).
 * A state nobody can watch is a state nobody can verify, and it regresses silently.
 *
 * How to use it: add `?devHoldSignIn=1` to any page URL, open the sign-in dialog,
 * and press Continue with Google. The dialog dispatches `connect` exactly as it
 * always does and simply does not start the redirect, so the button stays in the
 * state it would hold while Google loads. Close the dialog to leave. No Supabase
 * key is involved on either path.
 *
 * It cannot happen in production. `__DEV__` is a build-time constant that Metro
 * replaces with `false` in `expo export`, so this whole check folds to `false` and
 * the branch is dropped from the shipped bundle. That is the same fail-closed shape
 * the backend uses for its local auth bypass, which refuses to start when the
 * database target is production (`alethical/api/services/auth.py`, #97) — the gate
 * is a property of the build, never something a URL can talk its way past.
 */
export const HOLD_SIGN_IN_PARAM = 'devHoldSignIn';

/**
 * The gate on its own, so the production half is a thing a test can hold to rather
 * than a line somebody has to re-read. `isDevBuild` false → always false, whatever
 * the URL says.
 */
export function signInHoldRequested(search: string, isDevBuild: boolean): boolean {
  if (!isDevBuild) return false;
  return new URLSearchParams(search).get(HOLD_SIGN_IN_PARAM) === '1';
}

/** True when this development build's URL is asking to hold the connecting state. */
export function signInHeldConnecting(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return signInHoldRequested(window.location.search, __DEV__);
}
