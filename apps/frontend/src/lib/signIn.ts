// The sign-in dialog's copy and state machine, kept out of the component so both
// are plain data a test can read (docs/product-onboarding/sign-in-guide.md). One
// config drives every surface, so the web overlay and the phone sheet cannot say
// different things.
//
// Honesty rules this file carries (.claude/rules/grounded-answers.md):
//  - rule 6: no copy may promise an email or a push alert. Sending is not built
//    (#36) — the server records that an alert is due and sends nothing. The track
//    payoff we state is the saved list, which is real.
//  - rule 2: bill tracking is the only gated product action. Public vote records
//    stay public, so there is no votes sign-in intent.

export type SignInIntent = 'nav' | 'track';

/** Where the dialog is in its one flow: waiting, redirecting, or explaining a failure. */
export type SignInStatus = 'idle' | 'connecting' | 'error';

/** Why sign-in failed, which picks the message. */
export type SignInErrorKind = 'cancelled' | 'failed' | 'deactivated' | 'unverified-google';

export interface SignInRequest {
  intent: SignInIntent;
  /** Where to send the person after Google. Absent = back to the current page. */
  returnTo?: string;
  /** Bill the reader asked to track, persisted across Google's full-page redirect. */
  billId?: string;
  /** Bill identifier ("HF 4138") for the track intent, so the copy names it. */
  billCode?: string;
  /** Exact web scroll position to restore after the redirect. */
  scrollY?: number;
  /** Random one-use server reference for a signed-out Track press. */
  pendingReference?: string;
  /** Which verified auth path is allowed to consume the pending reference. */
  pendingCompletion?: 'ordinary' | 'email-link';
}

interface IntentConfig {
  /** Which icon tile the dialog shows. */
  icon: 'brand' | 'bell';
  headline: string;
  /** `billCode` is only read by the track intent. */
  subcopy: (billCode?: string) => string;
}

// The generic copy is shared by every plain Sign in button. Only a Track action
// gets a different reason and glyph (docs/product-onboarding/sign-in-guide.md).
const GENERIC_HEADLINE = 'Sign in to Alethical';
const GENERIC_SUBCOPY = 'Bills you track are saved to your account';

export const SIGN_IN_INTENTS: Record<SignInIntent, IntentConfig> = {
  nav: {
    icon: 'brand',
    headline: GENERIC_HEADLINE,
    subcopy: () => GENERIC_SUBCOPY,
  },
  track: {
    icon: 'bell',
    headline: GENERIC_HEADLINE,
    subcopy: () => 'This bill goes to your tracked list',
  },
};

export function signInCopy(intent: SignInIntent, billCode?: string) {
  const config = SIGN_IN_INTENTS[intent];
  return { headline: config.headline, subcopy: config.subcopy(billCode), icon: config.icon };
}

export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorKind, string> = {
  failed: 'Google isn’t responding. Try again in a moment.',
  cancelled: 'Google didn’t finish. Try again, or use email.',
  // Not a failure the reader can retry their way out of, so it says what happened
  // and who to ask rather than inviting another attempt (#1092).
  deactivated:
    'You’ve been signed out. Bills, votes and legislators are all still here to read. Contact us at ask@alethical.com if you think this is a mistake.',
  // A Google return whose email address Supabase has not confirmed. Shown as a
  // banner on the ordinary sign-in screen. The Google button stays on the card,
  // and Create account now owns the email-code proof (#1734).
  'unverified-google':
    'Sign-in couldn’t finish because the email needs confirmation. Use Create account with this email to confirm it.',
};

export const SIGN_IN_BUTTON_LABEL = 'Continue with Google';
export const SIGN_IN_RETRY_LABEL = 'Try again';

export function signInButtonLabel(status: SignInStatus): string {
  return status === 'error' ? SIGN_IN_RETRY_LABEL : SIGN_IN_BUTTON_LABEL;
}

/**
 * Google/Supabase report a person closing the consent screen as `access_denied`,
 * and Supabase reuses that same `error` value for callback failures it explains
 * further in `error_code` — so the specific code is checked first. Everything
 * else — a network failure, a misconfigured client — is the generic failure,
 * because we cannot tell those apart from the outside.
 */
export function signInErrorKind(
  code: string | null | undefined,
  errorCode?: string | null,
): SignInErrorKind {
  if (
    code === 'provider_email_needs_verification' ||
    errorCode === 'provider_email_needs_verification'
  ) {
    return 'unverified-google';
  }
  if (errorCode && errorCode !== 'provider_access_denied') return 'failed';
  return code === 'access_denied' ? 'cancelled' : 'failed';
}

/** Read and classify a Google failure from the phone browser's return URL. */
export function signInErrorKindFromCallback(callbackUrl: string): SignInErrorKind | null {
  let search = '';
  let hash = '';
  try {
    const url = new URL(callbackUrl);
    search = url.search;
    hash = url.hash;
  } catch {
    const hashIndex = callbackUrl.indexOf('#');
    const searchIndex = callbackUrl.indexOf('?');
    const searchEnd = hashIndex >= 0 ? hashIndex : callbackUrl.length;
    if (searchIndex >= 0 && searchIndex < searchEnd) {
      search = callbackUrl.slice(searchIndex, searchEnd);
    }
    if (hashIndex >= 0) hash = callbackUrl.slice(hashIndex);
  }

  const failure = parseAuthError(search, hash);
  return failure ? signInErrorKind(failure.code, failure.errorCode) : null;
}

/** Serious account results replace the ordinary form instead of appearing as a field error. */
export function dedicatedSignInOutcome(kind: string): SignInErrorKind | null {
  return kind === 'deactivated' ? kind : null;
}

export type AuthErrorReturnDecision = 'wait-for-session' | 'keep-success' | 'show-error';

/** Decide whether an OAuth error is still real after the saved session is checked. */
export function authErrorReturnDecision(
  isSessionLoading: boolean,
  isSignedIn: boolean,
): AuthErrorReturnDecision {
  if (isSessionLoading) return 'wait-for-session';
  return isSignedIn ? 'keep-success' : 'show-error';
}

/** Synchronously blocks a second press before React can redraw the busy button. */
export function createSignInAttemptGate() {
  let started = false;
  return {
    begin() {
      if (started) return false;
      started = true;
      return true;
    },
    reset() {
      started = false;
    },
  };
}

export interface SignInDialogState {
  open: boolean;
  intent: SignInIntent;
  returnTo?: string;
  billId?: string;
  billCode?: string;
  scrollY?: number;
  pendingReference?: string;
  pendingCompletion?: 'ordinary' | 'email-link';
  status: SignInStatus;
  errorKind: SignInErrorKind | null;
}

export type SignInAction =
  | { type: 'open'; request: SignInRequest }
  /** Reopened on the way back from Google, already knowing why it failed. */
  | { type: 'reopenWithError'; request: SignInRequest; kind: SignInErrorKind }
  | { type: 'connect' }
  | { type: 'fail'; kind: SignInErrorKind }
  /** A fresh form submission owns the screen: any reopened error is stale now. */
  | { type: 'clearError' }
  | { type: 'close' };

export const initialSignInState: SignInDialogState = {
  open: false,
  intent: 'nav',
  status: 'idle',
  errorKind: null,
};

export function signInReducer(state: SignInDialogState, action: SignInAction): SignInDialogState {
  switch (action.type) {
    case 'open':
      return {
        open: true,
        intent: action.request.intent,
        returnTo: action.request.returnTo,
        billId: action.request.billId,
        billCode: action.request.billCode,
        scrollY: action.request.scrollY,
        pendingReference: action.request.pendingReference,
        pendingCompletion: action.request.pendingCompletion,
        status: 'idle',
        errorKind: null,
      };
    case 'reopenWithError':
      return {
        open: true,
        intent: action.request.intent,
        returnTo: action.request.returnTo,
        billId: action.request.billId,
        billCode: action.request.billCode,
        scrollY: action.request.scrollY,
        pendingReference: action.request.pendingReference,
        pendingCompletion: action.request.pendingCompletion,
        status: 'error',
        errorKind: action.kind,
      };
    case 'connect':
      // Only a dialog on screen can start a redirect; a stray call is a no-op.
      if (!state.open) {
        return state;
      }
      return { ...state, status: 'connecting', errorKind: null };
    case 'fail':
      if (!state.open) {
        return state;
      }
      return { ...state, status: 'error', errorKind: action.kind };
    case 'clearError':
      if (!state.open || state.status !== 'error') {
        return state;
      }
      return { ...state, status: 'idle', errorKind: null };
    case 'close':
      return initialSignInState;
  }
}

/** The OAuth error params, whether the provider put them in the query or the hash. */
export function parseAuthError(
  search: string,
  hash: string,
): { code: string; errorCode: string | null; description: string | null } | null {
  for (const raw of [search, hash]) {
    const params = new URLSearchParams(raw.replace(/^[?#]/, ''));
    const code = params.get('error') ?? params.get('error_code');
    if (code) {
      return {
        code,
        // Supabase reuses `error=access_denied` for most callback failures and
        // puts the specific reason here, so both are needed to tell a person
        // closing Google's screen apart from an unconfirmed provider email.
        errorCode: params.get('error_code'),
        description: params.get('error_description'),
      };
    }
  }
  return null;
}

const AUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description'];

/**
 * The same URL with the OAuth failure params stripped from both the query and
 * the hash, so a reload or a shared link doesn't replay the error banner.
 */
export function urlWithoutAuthError(href: string): string {
  const url = new URL(href);
  for (const key of AUTH_ERROR_PARAMS) {
    url.searchParams.delete(key);
  }
  if (url.hash.length > 1) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    for (const key of AUTH_ERROR_PARAMS) {
      hashParams.delete(key);
    }
    const rest = hashParams.toString();
    url.hash = rest ? `#${rest}` : '';
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
