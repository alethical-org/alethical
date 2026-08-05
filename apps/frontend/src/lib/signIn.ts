// The sign-in dialog's copy and state machine, kept out of the component so both
// are plain data a test can read (docs/mockups/sign-in). One config drives every
// surface, so the web overlay and the phone sheet cannot say different things.
//
// Honesty rules this file carries (.claude/rules/grounded-answers.md):
//  - rule 6: no copy may promise an email or a push alert. Sending is not built
//    (#36) — the server records that an alert is due and sends nothing. The track
//    payoff we state is the saved list, which is real.
//  - rule 2: `votes` is configured but NOT live. A person's district is saved
//    nowhere, so nothing may route into it until #456 ships district persistence.

export type SignInIntent = 'nav' | 'track' | 'votes' | 'account';

/** Where the dialog is in its one flow: waiting, redirecting, or explaining a failure. */
export type SignInStatus = 'idle' | 'connecting' | 'error';

/** Why sign-in failed, which picks the message. */
export type SignInErrorKind = 'cancelled' | 'failed';

export interface SignInRequest {
  intent: SignInIntent;
  /** Where to send the person after Google. Absent = back to the current page. */
  returnTo?: string;
  /** Bill identifier ("HF 4138") for the track intent, so the copy names it. */
  billCode?: string;
}

interface IntentConfig {
  /** Which icon tile the dialog shows. */
  icon: 'brand' | 'bookmark' | 'capitol';
  headline: string;
  /** `billCode` is only read by the track intent. */
  subcopy: (billCode?: string) => string;
  /**
   * False = configured for a future gate, never openable today. `openSignIn`
   * refuses it, so wiring a dead gate is a no-op rather than a promise we can't
   * keep (grounded-answers.md rule 2).
   */
  live: boolean;
}

// The generic copy, shared by the plain nav button and the account/chat cards —
// the design treats "Account card" as the generic intent (docs/mockups/sign-in).
const GENERIC_HEADLINE = 'Sign in to Alethical';
const GENERIC_SUBCOPY =
  'Track bills across sessions and pick up right where you left off. Your tracked list is saved to your account.';

export const SIGN_IN_INTENTS: Record<SignInIntent, IntentConfig> = {
  nav: {
    icon: 'brand',
    headline: GENERIC_HEADLINE,
    subcopy: () => GENERIC_SUBCOPY,
    live: true,
  },
  account: {
    icon: 'brand',
    headline: GENERIC_HEADLINE,
    subcopy: () => GENERIC_SUBCOPY,
    live: true,
  },
  track: {
    icon: 'bookmark',
    headline: 'Sign in to track this bill',
    subcopy: (billCode?: string) =>
      `Save ${billCode ?? 'this bill'} to your tracked bills and check where it stands whenever you come back.`,
    live: true,
  },
  // Designed, deliberately unwired: nothing saves a district today — not to the
  // account, not to the device, not even in memory — and the columns set aside
  // for it are dead. Owned by #456.
  votes: {
    icon: 'capitol',
    headline: 'Sign in to see how your legislators voted',
    subcopy: () =>
      'Save your district once and every roll call shows how your senator and representative voted.',
    live: false,
  },
};

export function signInCopy(intent: SignInIntent, billCode?: string) {
  const config = SIGN_IN_INTENTS[intent];
  return { headline: config.headline, subcopy: config.subcopy(billCode), icon: config.icon };
}

/** False for an intent that is designed but has no shipped capability behind it. */
export function canOpenSignIn(intent: SignInIntent): boolean {
  return SIGN_IN_INTENTS[intent].live;
}

export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorKind, string> = {
  failed: 'Something went wrong reaching Google. Check your connection and try again.',
  cancelled:
    'Sign-in didn’t finish. The Google step was closed or cancelled before you were signed in. Try again when you’re ready.',
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
  billCode?: string;
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
      // A gate with nothing behind it never opens (grounded-answers.md rule 2).
      if (!canOpenSignIn(action.request.intent)) {
        return state;
      }
      return {
        open: true,
        intent: action.request.intent,
        returnTo: action.request.returnTo,
        billCode: action.request.billCode,
        status: 'idle',
        errorKind: null,
      };
    case 'reopenWithError':
      return {
        open: true,
        intent: canOpenSignIn(action.request.intent) ? action.request.intent : 'nav',
        returnTo: action.request.returnTo,
        billCode: action.request.billCode,
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
