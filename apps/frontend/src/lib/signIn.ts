// The sign-in dialog's copy and state machine, kept out of the component so both
// are plain data a test can read (docs/mockups/sign-in). One config drives every
// surface, so the web overlay and the phone sheet cannot say different things.
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
export type SignInErrorKind = 'cancelled' | 'failed' | 'deactivated';

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
}

interface IntentConfig {
  /** Which icon tile the dialog shows. */
  icon: 'brand' | 'bell';
  headline: string;
  /** `billCode` is only read by the track intent. */
  subcopy: (billCode?: string) => string;
}

// The generic copy is shared by every plain Sign in button. Only a Track action
// gets a different reason and glyph (docs/mockups/sign-in).
const GENERIC_HEADLINE = 'Sign in to Alethical';
const GENERIC_SUBCOPY =
  'Track bills across sessions and pick up where you left off. Your tracked list is saved to your account.';

export const SIGN_IN_INTENTS: Record<SignInIntent, IntentConfig> = {
  nav: {
    icon: 'brand',
    headline: GENERIC_HEADLINE,
    subcopy: () => GENERIC_SUBCOPY,
  },
  track: {
    icon: 'bell',
    headline: 'Sign in to track this bill',
    subcopy: () => GENERIC_SUBCOPY,
  },
};

export function signInCopy(intent: SignInIntent, billCode?: string) {
  const config = SIGN_IN_INTENTS[intent];
  return { headline: config.headline, subcopy: config.subcopy(billCode), icon: config.icon };
}

export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorKind, string> = {
  failed: 'Something went wrong reaching Google. Check your connection and try again.',
  cancelled:
    'Sign-in didn’t finish. The Google step was closed or cancelled before you were signed in. Try again when you’re ready.',
  // Not a failure the reader can retry their way out of, so it says what happened
  // and who to ask rather than inviting another attempt (#1092).
  deactivated:
    'This account has been deactivated, so we’ve signed you out. Bills, votes and legislators are all still here to read. Contact us at ask@alethical.com if you think this is a mistake.',
};

export const SIGN_IN_BUTTON_LABEL = 'Continue with Google';
export const SIGN_IN_RETRY_LABEL = 'Try again';

export function signInButtonLabel(status: SignInStatus): string {
  return status === 'error' ? SIGN_IN_RETRY_LABEL : SIGN_IN_BUTTON_LABEL;
}

/**
 * Google/Supabase report a person closing the consent screen as `access_denied`.
 * Everything else — a network failure, a misconfigured client — is the generic
 * failure, because we cannot tell those apart from the outside.
 */
export function signInErrorKind(code: string | null | undefined): SignInErrorKind {
  return code === 'access_denied' ? 'cancelled' : 'failed';
}

export interface SignInDialogState {
  open: boolean;
  intent: SignInIntent;
  returnTo?: string;
  billId?: string;
  billCode?: string;
  scrollY?: number;
  status: SignInStatus;
  errorKind: SignInErrorKind | null;
}

export type SignInAction =
  | { type: 'open'; request: SignInRequest }
  /** Reopened on the way back from Google, already knowing why it failed. */
  | { type: 'reopenWithError'; request: SignInRequest; kind: SignInErrorKind }
  | { type: 'connect' }
  | { type: 'fail'; kind: SignInErrorKind }
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
    case 'close':
      return initialSignInState;
  }
}

/** The OAuth error params, whether the provider put them in the query or the hash. */
export function parseAuthError(
  search: string,
  hash: string,
): { code: string; description: string | null } | null {
  for (const raw of [search, hash]) {
    const params = new URLSearchParams(raw.replace(/^[?#]/, ''));
    const code = params.get('error') ?? params.get('error_code');
    if (code) {
      return { code, description: params.get('error_description') };
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
