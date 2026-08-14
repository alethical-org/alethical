import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { SignInDialog } from '../components/auth/SignInDialog';
import {
  SignInRequest,
  SIGN_IN_ERROR_MESSAGES,
  authErrorReturnDecision,
  createSignInAttemptGate,
  dedicatedSignInOutcome,
  initialSignInState,
  parseAuthError,
  signInErrorKind,
  signInReducer,
  urlWithoutAuthError,
} from '../lib/signIn';
import { pendingSignInRequest } from '../lib/trackIntent';
import { buildEmailLinkRedirectUrl, requestedSignInState } from '../lib/auth/linkSession';
import {
  ApiError,
  completePendingTrackActionFromApi,
  createPendingTrackActionFromApi,
} from '../data/api';
import type { SignInDialogActionResult, SignInDialogScreen } from '../components/auth/SignInDialog';
import { SignInModalContext } from './signInModalContext';
import { signInHeldConnecting } from '../lib/devSignInHold';
import { useAuth } from './AuthProvider';

// One dialog for the whole app. Any button anywhere calls `openSignIn(...)` with
// why it is asking; nothing re-implements a sign-in box per screen.
//
// Web sign-in is a full-page redirect to Google (AuthProvider), so a failure does
// not arrive while the dialog is open — it arrives in the URL of the page we come
// back to. That is why the request is stashed before redirecting: it is the only
// way the dialog can reopen still knowing what the person was trying to do.

const isWeb = Platform.OS === 'web';
const PENDING_KEY = 'alethical.pendingSignIn';
const OPEN_SIGN_IN_KEY = 'alethical.openSignIn';
const EMAIL_PASSWORD_ENABLED = process.env.EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED === 'true';
const configuredResendWait = Number(process.env.EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS);
const RESEND_WAIT_SECONDS =
  Number.isFinite(configuredResendWait) && configuredResendWait > 0 ? configuredResendWait : 60;

function stashPendingSignIn(request: SignInRequest) {
  if (!isWeb || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(request));
  } catch {
    // Storage can be unavailable (private browsing). The dialog still reopens on
    // the way back, just with the generic intent.
  }
}

function readPendingSignIn(): SignInRequest | null {
  if (!isWeb || typeof window === 'undefined') return null;
  try {
    return pendingSignInRequest(window.sessionStorage.getItem(PENDING_KEY));
  } catch {
    return null;
  }
}

function clearPendingSignIn() {
  if (!isWeb || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // The page still works when browser storage is unavailable.
  }
}

function readRequestedScreen(): SignInDialogScreen | undefined {
  if (!isWeb || typeof window === 'undefined') return undefined;
  let storedScreen: string | null = null;
  try {
    storedScreen = window.sessionStorage.getItem(OPEN_SIGN_IN_KEY);
    window.sessionStorage.removeItem(OPEN_SIGN_IN_KEY);
  } catch {
    // The non-secret hash below survives when browser storage is unavailable.
  }
  const requested = requestedSignInState(storedScreen, window.location.hash);
  if (window.location.hash !== requested.cleanHash) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${requested.cleanHash}`,
    );
  }
  return requested.screen;
}

function confirmationUrl(pendingReference?: string) {
  if (!isWeb || typeof window === 'undefined') return 'alethical://confirm#auth_action=confirm';
  return buildEmailLinkRedirectUrl(window.location.origin, 'confirm', pendingReference);
}

function resetUrl() {
  if (!isWeb || typeof window === 'undefined') return 'alethical://reset#auth_action=reset';
  return buildEmailLinkRedirectUrl(window.location.origin, 'reset');
}

function restoreScrollPosition(scrollY?: number) {
  if (!isWeb || typeof window === 'undefined' || !scrollY) return () => {};
  const startedAt = Date.now();
  const restore = () => {
    window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
    if (Math.abs(window.scrollY - scrollY) <= 1 || Date.now() - startedAt > 15_000) {
      window.clearInterval(timer);
    }
  };
  const timer = window.setInterval(restore, 100);
  restore();
  return () => window.clearInterval(timer);
}

export function SignInModalProvider({ children }: PropsWithChildren) {
  const {
    isLoading,
    isSignedIn,
    accessToken,
    authError,
    authErrorKind,
    dismissAuthError,
    signInWithGoogle,
    signInWithPassword,
    createAccount,
    resendConfirmation,
    sendPasswordReset,
  } = useAuth();
  const [state, dispatch] = useReducer(signInReducer, initialSignInState);
  const pendingRequest = useRef<SignInRequest | null>(readPendingSignIn());
  const signInAttemptGate = useRef(createSignInAttemptGate()).current;
  const requestedScreen = useRef(readRequestedScreen());
  const [initialScreen, setInitialScreen] = useState<SignInDialogScreen | undefined>(
    requestedScreen.current,
  );
  const [busyAction, setBusyAction] = useState<
    'google' | 'sign-in' | 'create' | 'resend' | 'forgot' | null
  >(null);

  const openSignIn = useCallback(
    (request: SignInRequest) => {
      // Already signed in: the design's "you're already signed in" panel is a
      // step in the way, so we just let the caller's action proceed.
      if (isSignedIn) return;
      pendingRequest.current = { ...request };
      setInitialScreen('sign-in');
      dispatch({ type: 'open', request });
    },
    [isSignedIn],
  );

  const close = useCallback(() => {
    dismissAuthError();
    signInAttemptGate.reset();
    pendingRequest.current = null;
    clearPendingSignIn();
    dispatch({ type: 'close' });
    setBusyAction(null);
  }, [dismissAuthError, signInAttemptGate]);

  const ensurePendingReference = useCallback(async (completion: 'ordinary' | 'email-link') => {
    const existing = pendingRequest.current;
    if (!existing || existing.intent !== 'track' || !existing.billId) return undefined;
    if (existing.pendingReference && existing.pendingCompletion === completion) {
      return existing.pendingReference;
    }
    const created = await createPendingTrackActionFromApi(
      existing.billId,
      existing.returnTo ?? '/',
    );
    existing.pendingReference = created.reference;
    existing.pendingCompletion = completion;
    stashPendingSignIn(existing);
    return created.reference;
  }, []);

  const onContinue = useCallback(async () => {
    if (!signInAttemptGate.begin()) return;
    setBusyAction('google');
    dispatch({ type: 'connect' });
    // Development builds only: stop here so the connecting state can be looked at
    // (lib/devSignInHold.ts). Nothing is stashed because nothing is coming back.
    if (signInHeldConnecting()) {
      signInAttemptGate.reset();
      setBusyAction(null);
      return;
    }
    const request: SignInRequest = {
      intent: state.intent,
      returnTo: state.returnTo,
      billId: state.billId,
      billCode: state.billCode,
      scrollY: state.scrollY,
    };
    pendingRequest.current = request;
    try {
      await ensurePendingReference('ordinary');
      stashPendingSignIn(request);
      const result = await signInWithGoogle(state.returnTo);
      if (!result.ok) {
        signInAttemptGate.reset();
        setBusyAction(null);
      }
    } catch {
      signInAttemptGate.reset();
      setBusyAction(null);
      dispatch({ type: 'fail', kind: 'failed' });
    }
  }, [
    ensurePendingReference,
    signInAttemptGate,
    signInWithGoogle,
    state.billCode,
    state.billId,
    state.intent,
    state.returnTo,
    state.scrollY,
  ]);

  const completeOrdinaryPending = useCallback(async (token: string | null) => {
    const request = pendingRequest.current;
    if (!token || !request?.pendingReference || request.pendingCompletion !== 'ordinary') {
      return;
    }
    await completePendingTrackActionFromApi(token, request.pendingReference);
  }, []);

  const onPasswordSignIn = useCallback(
    async (email: string, password: string): Promise<SignInDialogActionResult> => {
      setBusyAction('sign-in');
      try {
        await ensurePendingReference('ordinary');
        const result = await signInWithPassword(email, password);
        if (!result.ok) {
          const outcome = dedicatedSignInOutcome(result.error.kind);
          if (outcome) dispatch({ type: 'fail', kind: outcome });
          return result;
        }
        return { ok: true };
      } finally {
        setBusyAction(null);
      }
    },
    [ensurePendingReference, signInWithPassword],
  );

  const onCreateAccount = useCallback(
    async (email: string, password: string): Promise<SignInDialogActionResult> => {
      setBusyAction('create');
      try {
        const pendingReference = await ensurePendingReference('email-link');
        const result = await createAccount(email, password, confirmationUrl(pendingReference));
        if (!result.ok) {
          const outcome = dedicatedSignInOutcome(result.error.kind);
          if (outcome) dispatch({ type: 'fail', kind: outcome });
          return result;
        }
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: {
            kind: 'request-failure',
            message: 'We couldn’t complete that request. Check your connection and try again.',
          },
        };
      } finally {
        setBusyAction(null);
      }
    },
    [createAccount, ensurePendingReference],
  );

  const onResendConfirmation = useCallback(
    async (email: string): Promise<SignInDialogActionResult> => {
      setBusyAction('resend');
      try {
        const pendingReference = await ensurePendingReference('email-link');
        const result = await resendConfirmation(email, confirmationUrl(pendingReference));
        return result.ok ? { ok: true } : result;
      } finally {
        setBusyAction(null);
      }
    },
    [ensurePendingReference, resendConfirmation],
  );

  const onForgotPassword = useCallback(
    async (email: string): Promise<SignInDialogActionResult> => {
      setBusyAction('forgot');
      try {
        const result = await sendPasswordReset(email, resetUrl());
        return result.ok ? { ok: true } : result;
      } finally {
        setBusyAction(null);
      }
    },
    [sendPasswordReset],
  );

  // Signing in anywhere — including a second tab — closes the dialog. When this
  // tab came back from a Track request, finish that exact idempotent write first.
  const authWasSignedIn = useRef(isSignedIn);
  useEffect(() => {
    const justSignedIn = isSignedIn && !authWasSignedIn.current;
    authWasSignedIn.current = isSignedIn;
    if (!isSignedIn || (!justSignedIn && !pendingRequest.current)) return;
    signInAttemptGate.reset();
    setBusyAction(null);
    const request = pendingRequest.current;
    const finishSignedInRequest = () => {
      pendingRequest.current = null;
      clearPendingSignIn();
      const stopRestoringScroll = restoreScrollPosition(request?.scrollY);
      dispatch({ type: 'close' });
      return stopRestoringScroll;
    };
    if (request?.pendingCompletion === 'email-link') return finishSignedInRequest();
    void completeOrdinaryPending(accessToken)
      .then(finishSignedInRequest)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 410) {
          finishSignedInRequest();
          return;
        }
        dispatch({ type: 'fail', kind: 'failed' });
      });
  }, [accessToken, completeOrdinaryPending, isSignedIn, signInAttemptGate]);

  // A provider result can arrive before a redirect, after a full-page return,
  // or when an old account is found during an ordinary read. Serious account
  // results always open their dedicated screen; a request failure reopens only
  // when a sign-in request was in progress.
  useEffect(() => {
    if (!authError) return;
    const kind = authErrorKind ?? 'failed';
    if (kind === 'cancelled') {
      if (state.status === 'connecting') close();
      return;
    }
    const serious = dedicatedSignInOutcome(kind);
    const request = pendingRequest.current;
    if (!serious && state.status !== 'connecting' && !request) return;
    if (state.status === 'error' && state.errorKind === kind) return;
    signInAttemptGate.reset();
    setBusyAction(null);
    if (state.open) {
      dispatch({ type: 'fail', kind });
    } else {
      dispatch({ type: 'reopenWithError', request: request ?? { intent: 'nav' }, kind });
    }
  }, [
    authError,
    authErrorKind,
    close,
    signInAttemptGate,
    state.errorKind,
    state.open,
    state.status,
  ]);

  // The web return trip: Google sends failures back as URL params on the page we
  // asked it to return to. Reopen the dialog where it left off, then take the
  // params out of the address bar so a reload doesn't replay the error.
  const returnHandled = useRef(false);
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined' || returnHandled.current) return;
    const failure = parseAuthError(window.location.search, window.location.hash);
    if (!failure) {
      returnHandled.current = true;
      return;
    }
    const decision = authErrorReturnDecision(isLoading, isSignedIn);
    if (decision === 'wait-for-session') return;
    returnHandled.current = true;
    window.history.replaceState(null, '', urlWithoutAuthError(window.location.href));
    if (decision === 'keep-success') return;
    signInAttemptGate.reset();
    setBusyAction(null);
    const pending = pendingRequest.current;
    const failureKind = signInErrorKind(failure.code, failure.errorCode);
    if (failureKind === 'cancelled') {
      close();
      return;
    }
    pendingRequest.current = null;
    clearPendingSignIn();
    dispatch({
      type: 'reopenWithError',
      request: pending ?? { intent: 'nav' },
      kind: failureKind,
    });
  }, [close, isLoading, isSignedIn, signInAttemptGate]);

  const value = useMemo(() => ({ openSignIn }), [openSignIn]);

  useEffect(() => {
    if (!requestedScreen.current || isLoading || isSignedIn || state.open) return;
    requestedScreen.current = undefined;
    dispatch({ type: 'open', request: { intent: 'nav' } });
  }, [isLoading, isSignedIn, state.open]);

  return (
    <SignInModalContext.Provider value={value}>
      {children}
      <SignInDialog
        open={state.open}
        intent={state.intent}
        billCode={state.billCode}
        initialScreen={initialScreen}
        errorMessage={state.errorKind ? SIGN_IN_ERROR_MESSAGES[state.errorKind] : null}
        errorKind={state.errorKind}
        busyAction={busyAction}
        emailPasswordEnabled={EMAIL_PASSWORD_ENABLED}
        resendWaitSeconds={RESEND_WAIT_SECONDS}
        onClose={close}
        onGoogle={onContinue}
        onPasswordSignIn={onPasswordSignIn}
        onCreateAccount={onCreateAccount}
        onResendConfirmation={onResendConfirmation}
        onForgotPassword={onForgotPassword}
        onBackFromOutcome={() => {
          dismissAuthError();
          dispatch({
            type: 'open',
            request: {
              intent: state.intent,
              returnTo: state.returnTo,
              billId: state.billId,
              billCode: state.billCode,
              scrollY: state.scrollY,
              pendingReference: state.pendingReference,
              pendingCompletion: state.pendingCompletion,
            },
          });
        }}
      />
    </SignInModalContext.Provider>
  );
}
