const PENDING_SIGN_IN_KEY = 'alethical.pendingSignIn';
const OPEN_SIGN_IN_KEY = 'alethical.openSignIn';

/** Remove account-specific browser drafts only after local sign-out succeeds. */
export function clearSignedInAuthDrafts() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_SIGN_IN_KEY);
    window.sessionStorage.removeItem(OPEN_SIGN_IN_KEY);
  } catch {
    // Sign-out remains successful when browser storage is unavailable.
  }
}
