import { PropsWithChildren, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Platform } from 'react-native';

import { SignInDialog } from '../components/auth/SignInDialog';
import {
  SignInRequest,
  initialSignInState,
  parseAuthError,
  signInErrorKind,
  signInReducer,
  urlWithoutAuthError,
} from '../lib/signIn';
import { pendingSignInRequest } from '../lib/trackIntent';
import { SignInModalContext } from './signInModalContext';
import { signInHeldConnecting } from '../lib/devSignInHold';
import { useAuth } from './AuthProvider';
import { useTrackedBillWrite } from './trackedBillWriteContext';

// One dialog for the whole app. Any button anywhere calls `openSignIn(...)` with
// why it is asking; nothing re-implements a sign-in box per screen.
//
// Web sign-in is a full-page redirect to Google (AuthProvider), so a failure does
// not arrive while the dialog is open — it arrives in the URL of the page we come
// back to. That is why the request is stashed before redirecting: it is the only
// way the dialog can reopen still knowing what the person was trying to do.

const isWeb = Platform.OS === 'web';
const PENDING_KEY = 'alethical.pendingSignIn';

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
  const { isSignedIn, authError, authErrorKind, signInWithGoogle } = useAuth();
  const { setTrackedBill } = useTrackedBillWrite();
  const [state, dispatch] = useReducer(signInReducer, initialSignInState);
  const pendingRequest = useRef<SignInRequest | null>(readPendingSignIn());

  const openSignIn = useCallback(
    (request: SignInRequest) => {
      // Already signed in: the design's "you're already signed in" panel is a
      // step in the way, so we just let the caller's action proceed.
      if (isSignedIn) return;
      dispatch({ type: 'open', request });
    },
    [isSignedIn],
  );

  const close = useCallback(() => {
    pendingRequest.current = null;
    clearPendingSignIn();
    dispatch({ type: 'close' });
  }, []);

  const onContinue = useCallback(() => {
    dispatch({ type: 'connect' });
    // Development builds only: stop here so the connecting state can be looked at
    // (lib/devSignInHold.ts). Nothing is stashed because nothing is coming back.
    if (signInHeldConnecting()) return;
    const request: SignInRequest = {
      intent: state.intent,
      returnTo: state.returnTo,
      billId: state.billId,
      billCode: state.billCode,
      scrollY: state.scrollY,
    };
    pendingRequest.current = request;
    stashPendingSignIn(request);
    void signInWithGoogle(state.returnTo);
  }, [signInWithGoogle, state.billCode, state.billId, state.intent, state.returnTo, state.scrollY]);

  // Signing in anywhere — including a second tab — closes the dialog. When this
  // tab came back from a Track request, finish that exact idempotent write first.
  const authWasSignedIn = useRef(isSignedIn);
  useEffect(() => {
    const justSignedIn = isSignedIn && !authWasSignedIn.current;
    authWasSignedIn.current = isSignedIn;
    if (!isSignedIn || (!justSignedIn && !pendingRequest.current)) return;
    const request = pendingRequest.current;
    pendingRequest.current = null;
    clearPendingSignIn();
    const stopRestoringScroll = restoreScrollPosition(request?.scrollY);
    if (request?.intent === 'track' && request.billId) {
      setTrackedBill(request.billId, true);
    }
    dispatch({ type: 'close' });
    return stopRestoringScroll;
  }, [isSignedIn, setTrackedBill]);

  // A failure we can see live: the native Google sheet being dismissed, or
  // Supabase refusing before any redirect happens.
  useEffect(() => {
    if (authError && state.status === 'connecting') {
      dispatch({ type: 'fail', kind: authErrorKind ?? 'failed' });
    }
  }, [authError, authErrorKind, state.status]);

  // The web return trip: Google sends failures back as URL params on the page we
  // asked it to return to. Reopen the dialog where it left off, then take the
  // params out of the address bar so a reload doesn't replay the error.
  const returnHandled = useRef(false);
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined' || returnHandled.current) return;
    returnHandled.current = true;
    const failure = parseAuthError(window.location.search, window.location.hash);
    const pending = pendingRequest.current;
    if (!failure) return;
    pendingRequest.current = null;
    clearPendingSignIn();
    dispatch({
      type: 'reopenWithError',
      request: pending ?? { intent: 'nav' },
      kind: signInErrorKind(failure.code),
    });
    window.history.replaceState(null, '', urlWithoutAuthError(window.location.href));
  }, []);

  const value = useMemo(() => ({ openSignIn }), [openSignIn]);

  return (
    <SignInModalContext.Provider value={value}>
      {children}
      <SignInDialog state={state} onClose={close} onContinue={onContinue} />
    </SignInModalContext.Provider>
  );
}
