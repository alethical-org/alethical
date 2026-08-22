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
import type { Session } from '@supabase/auth-js';

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
import { useRefreshTrackedBills } from '../hooks/useAppQueries';
import { pendingSignInRequest } from '../lib/trackIntent';
import {
  buildEmailLinkRedirectUrl,
  canOpenRequestedSignInScreen,
  requestedSignInState,
} from '../lib/auth/linkSession';
import { createTemporaryAuthClient } from '../lib/auth/linkSession';
import {
  AccountCodeAccessController,
  type AccountCodePasswordResult,
  type AccountCodePurpose,
  type OrdinaryAccountSnapshot,
  readStableOrdinaryAccount,
} from '../lib/auth/accountCodeFlow';
import { PasswordSignInController } from '../lib/auth/passwordSignInFlow';
import { validateAlethicalSession } from '../lib/auth/operations';
import { normalizeEmail } from '../lib/auth/rev9Auth';
import {
  ApiError,
  completePendingTrackActionFromApi,
  createPendingTrackActionFromApi,
} from '../data/api';
import type { SignInDialogActionResult, SignInDialogScreen } from '../components/auth/SignInDialog';
import type {
  AccountCodePasswordActionResult,
  OpenAccountSummary,
} from '../components/auth/SignInDialog';
import { SignInModalContext } from './signInModalContext';
import { signInHeldConnecting } from '../lib/devSignInHold';
import { useAuth } from './AuthProvider';
import {
  clearOrdinarySessionIfUnchanged,
  setOrdinarySessionIfUnchanged,
  supabase,
  supabaseAuthConfig,
} from '../lib/supabase';

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
  if (!isWeb || typeof window === 'undefined') return 'alethical://auth/callback';
  return buildEmailLinkRedirectUrl(window.location.origin, 'confirm', pendingReference);
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

function accountSummary(account: OrdinaryAccountSnapshot['account']): OpenAccountSummary {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
  };
}

async function readValidatedOrdinaryAccount(): Promise<OrdinaryAccountSnapshot | null> {
  return readStableOrdinaryAccount(supabase.auth, validateAlethicalSession);
}

async function currentOpenAccount(): Promise<OpenAccountSummary | null> {
  const current = await readValidatedOrdinaryAccount();
  return current ? accountSummary(current.account) : null;
}

const ordinarySessionClient = {
  getSession: () => supabase.auth.getSession(),
  setSessionIfUnchanged: setOrdinarySessionIfUnchanged,
  clearSessionIfUnchanged: clearOrdinarySessionIfUnchanged,
};

export function SignInModalProvider({ children }: PropsWithChildren) {
  const {
    isLoading,
    isSignedIn,
    accessToken,
    authError,
    authErrorKind,
    dismissAuthError,
    signInWithGoogle,
    user,
  } = useAuth();
  const refreshTrackedBills = useRefreshTrackedBills(user?.id);
  const [state, dispatch] = useReducer(signInReducer, initialSignInState);
  const pendingRequest = useRef<SignInRequest | null>(readPendingSignIn());
  const signInAttemptGate = useRef(createSignInAttemptGate()).current;
  const accountCodeAccess = useRef<AccountCodeAccessController | null>(null);
  const accountCodeCleanup = useRef<Promise<void>>(Promise.resolve());
  const accountCodeStarting = useRef<number | null>(null);
  const ordinarySignInStarting = useRef<number | null>(null);
  const passwordSignInAccess = useRef<PasswordSignInController | null>(null);
  const passwordSignInCleanup = useRef<Promise<void>>(Promise.resolve());
  const ordinaryCompletionRequested = useRef(false);
  const [ordinaryCompletionTick, setOrdinaryCompletionTick] = useState(0);
  const accountChoiceRunning = useRef(false);
  const operationGeneration = useRef(0);
  const ordinaryCompletion = useRef<{
    request: SignInRequest | null;
    accessToken: string | null;
  } | null>(null);
  const requestedScreen = useRef(readRequestedScreen());
  const requestedAccountScreenOpen = useRef(
    canOpenRequestedSignInScreen(requestedScreen.current, true),
  );
  const [initialScreen, setInitialScreen] = useState<SignInDialogScreen | undefined>(
    requestedScreen.current,
  );
  const [busyAction, setBusyAction] = useState<
    | 'google'
    | 'sign-in'
    | 'request-code'
    | 'verify-code'
    | 'save-password'
    | 'finish-code'
    | 'switch-account'
    | null
  >(null);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const openSignIn = useCallback(
    (request: SignInRequest) => {
      // Already signed in: the design's "you're already signed in" panel is a
      // step in the way, so we just let the caller's action proceed.
      if (isSignedIn) return;
      requestedAccountScreenOpen.current = false;
      requestedScreen.current = undefined;
      pendingRequest.current = { ...request };
      setInitialScreen('sign-in');
      dispatch({ type: 'open', request });
    },
    [isSignedIn],
  );

  const close = useCallback(() => {
    requestedAccountScreenOpen.current = false;
    operationGeneration.current += 1;
    accountCodeStarting.current = null;
    ordinarySignInStarting.current = null;
    ordinaryCompletionRequested.current = false;
    accountChoiceRunning.current = false;
    const codeAccess = accountCodeAccess.current;
    accountCodeAccess.current = null;
    if (codeAccess) {
      accountCodeCleanup.current = codeAccess.dispose().catch(() => undefined);
    }
    const passwordAccess = passwordSignInAccess.current;
    passwordSignInAccess.current = null;
    if (passwordAccess) {
      passwordSignInCleanup.current = passwordAccess.dispose().catch(() => undefined);
    }
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
    if (pendingRequest.current !== existing) return undefined;
    existing.pendingReference = created.reference;
    existing.pendingCompletion = completion;
    stashPendingSignIn(existing);
    return created.reference;
  }, []);

  const onContinue = useCallback(async () => {
    if (!signInAttemptGate.begin()) return;
    requestedAccountScreenOpen.current = false;
    const generation = operationGeneration.current;
    ordinarySignInStarting.current = generation;
    const finishStarting = () => {
      if (ordinarySignInStarting.current !== generation) return;
      ordinarySignInStarting.current = null;
      if (accessTokenRef.current) ordinaryCompletionRequested.current = true;
      setOrdinaryCompletionTick((current) => current + 1);
    };
    const codeAccess = accountCodeAccess.current;
    accountCodeAccess.current = null;
    if (codeAccess) {
      accountCodeCleanup.current = codeAccess.dispose().catch(() => undefined);
    }
    const passwordAccess = passwordSignInAccess.current;
    passwordSignInAccess.current = null;
    if (passwordAccess) {
      passwordSignInCleanup.current = passwordAccess.dispose().catch(() => undefined);
    }
    await Promise.all([accountCodeCleanup.current, passwordSignInCleanup.current]);
    if (operationGeneration.current !== generation) return;
    setBusyAction('google');
    dispatch({ type: 'connect' });
    // Development builds only: stop here so the connecting state can be looked at
    // (lib/devSignInHold.ts). Nothing is stashed because nothing is coming back.
    if (signInHeldConnecting()) {
      finishStarting();
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
      if (operationGeneration.current !== generation) return;
      if (accessTokenRef.current) {
        finishStarting();
        return;
      }
      stashPendingSignIn(request);
      const result = await signInWithGoogle(state.returnTo);
      if (operationGeneration.current !== generation) return;
      finishStarting();
      if (!result.ok) {
        signInAttemptGate.reset();
        setBusyAction(null);
      }
    } catch {
      if (operationGeneration.current !== generation) return;
      finishStarting();
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

  const completeOrdinaryPending = useCallback(
    async (token: string | null, request: SignInRequest | null) => {
      if (!token || !request?.pendingReference || request.pendingCompletion !== 'ordinary') {
        return;
      }
      await completePendingTrackActionFromApi(token, request.pendingReference);
    },
    [],
  );

  // A fresh submission owns the screen: drop any error the dialog reopened
  // with, so a stale banner (e.g. the unverified-Google result) cannot mask
  // the new attempt's real outcome (#1533).
  const clearReopenedError = useCallback(() => {
    dismissAuthError();
    dispatch({ type: 'clearError' });
  }, [dismissAuthError]);

  const isCurrentAccountCodeOperation = useCallback(
    (generation: number, controller: AccountCodeAccessController) =>
      operationGeneration.current === generation && accountCodeAccess.current === controller,
    [],
  );

  const onPasswordSignIn = useCallback(
    async (email: string, password: string): Promise<SignInDialogActionResult> => {
      requestedAccountScreenOpen.current = false;
      const generation = operationGeneration.current;
      ordinarySignInStarting.current = generation;
      let controller: PasswordSignInController | null = null;
      clearReopenedError();
      setBusyAction('sign-in');
      try {
        await Promise.all([accountCodeCleanup.current, passwordSignInCleanup.current]);
        if (operationGeneration.current !== generation) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This sign-in was cancelled.' },
          };
        }
        const codeAccess = accountCodeAccess.current;
        accountCodeAccess.current = null;
        await codeAccess?.dispose();
        if (operationGeneration.current !== generation) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This sign-in was cancelled.' },
          };
        }
        await ensurePendingReference('ordinary');
        if (operationGeneration.current !== generation) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This sign-in was cancelled.' },
          };
        }
        const temporary = createTemporaryAuthClient(
          supabaseAuthConfig.url,
          supabaseAuthConfig.publishableKey,
        );
        controller = new PasswordSignInController(
          temporary,
          ordinarySessionClient,
          validateAlethicalSession,
        );
        passwordSignInAccess.current = controller;
        if (ordinarySignInStarting.current === generation) {
          ordinarySignInStarting.current = null;
        }
        const result = await controller.signIn(email, password);
        if (
          operationGeneration.current !== generation ||
          passwordSignInAccess.current !== controller
        ) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This sign-in was cancelled.' },
          };
        }
        passwordSignInAccess.current = null;
        if (!result.ok) {
          await controller.dispose();
          if (operationGeneration.current !== generation) {
            return {
              ok: false,
              error: { kind: 'request-failure', message: 'This sign-in was cancelled.' },
            };
          }
          if (accessTokenRef.current) ordinaryCompletionRequested.current = true;
          setOrdinaryCompletionTick((current) => current + 1);
          const outcome = dedicatedSignInOutcome(result.error.kind);
          if (outcome) dispatch({ type: 'fail', kind: outcome });
          return result;
        }
        ordinaryCompletionRequested.current = true;
        setOrdinaryCompletionTick((current) => current + 1);
        return { ok: true };
      } finally {
        if (ordinarySignInStarting.current === generation) {
          ordinarySignInStarting.current = null;
          if (accessTokenRef.current) ordinaryCompletionRequested.current = true;
          setOrdinaryCompletionTick((current) => current + 1);
        }
        if (
          operationGeneration.current === generation &&
          (!controller ||
            passwordSignInAccess.current === controller ||
            passwordSignInAccess.current === null)
        ) {
          setBusyAction(null);
        }
      }
    },
    [clearReopenedError, ensurePendingReference],
  );

  const onRequestAccountCode = useCallback(
    async (email: string, purpose: AccountCodePurpose): Promise<SignInDialogActionResult> => {
      const generation = operationGeneration.current;
      accountCodeStarting.current = generation;
      let controller: AccountCodeAccessController | null = null;
      clearReopenedError();
      setBusyAction('request-code');
      const safeEmail = normalizeEmail(email);
      try {
        await accountCodeCleanup.current;
        if (operationGeneration.current !== generation) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This request was cancelled.' },
          };
        }
        const pendingReference = await ensurePendingReference('email-link');
        if (operationGeneration.current !== generation) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This request was cancelled.' },
          };
        }
        controller = accountCodeAccess.current;
        if (controller && (controller.email !== safeEmail || controller.purpose !== purpose)) {
          const replacedController = controller;
          await replacedController.dispose();
          if (
            operationGeneration.current !== generation ||
            accountCodeAccess.current !== replacedController
          ) {
            return {
              ok: false,
              error: { kind: 'request-failure', message: 'This request was cancelled.' },
            };
          }
          accountCodeAccess.current = null;
          controller = null;
        }
        if (!controller) {
          const temporary = createTemporaryAuthClient(
            supabaseAuthConfig.url,
            supabaseAuthConfig.publishableKey,
          );
          controller = new AccountCodeAccessController(
            purpose,
            safeEmail,
            temporary,
            ordinarySessionClient,
            validateAlethicalSession,
            readValidatedOrdinaryAccount,
            async (temporarySession, signal) => {
              if (!pendingReference) return;
              try {
                await completePendingTrackActionFromApi(
                  temporarySession.access_token,
                  pendingReference,
                  signal,
                );
              } catch (error) {
                if (!(error instanceof ApiError && error.status === 410)) throw error;
              }
              refreshTrackedBills();
            },
          );
          accountCodeAccess.current = controller;
        }
        const result = await controller.request(confirmationUrl(pendingReference));
        if (!isCurrentAccountCodeOperation(generation, controller)) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This request was cancelled.' },
          };
        }
        return result.ok ? { ok: true } : result;
      } catch {
        if (
          operationGeneration.current !== generation ||
          (controller && accountCodeAccess.current !== controller)
        ) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This request was cancelled.' },
          };
        }
        return {
          ok: false,
          error: {
            kind: 'request-failure',
            message: 'We couldn’t request a code. Check your connection and try again.',
          },
        };
      } finally {
        if (accountCodeStarting.current === generation) accountCodeStarting.current = null;
        if (
          operationGeneration.current === generation &&
          (!controller || accountCodeAccess.current === controller)
        ) {
          setBusyAction(null);
        }
      }
    },
    [
      clearReopenedError,
      ensurePendingReference,
      isCurrentAccountCodeOperation,
      refreshTrackedBills,
    ],
  );

  const onVerifyAccountCode = useCallback(
    async (code: string) => {
      const generation = operationGeneration.current;
      const controller = accountCodeAccess.current;
      clearReopenedError();
      setBusyAction('verify-code');
      try {
        if (!controller) {
          return {
            ok: false as const,
            error: {
              kind: 'request-failure',
              message: 'We couldn’t check that code. Check your connection and try again.',
            },
          };
        }
        const verified = await controller.verify(code);
        if (!isCurrentAccountCodeOperation(generation, controller)) {
          return {
            ok: false as const,
            error: { kind: 'request-failure' as const, message: 'This request was cancelled.' },
          };
        }
        if (!verified.ok) {
          const outcome = dedicatedSignInOutcome(verified.error.kind);
          if (outcome) dispatch({ type: 'fail', kind: outcome });
          return verified;
        }
        const alreadyOpen = await controller.finishCreateIfSameAccountOpen();
        if (!isCurrentAccountCodeOperation(generation, controller)) {
          return {
            ok: false as const,
            error: { kind: 'request-failure' as const, message: 'This request was cancelled.' },
          };
        }
        if (!alreadyOpen.ok) return alreadyOpen;
        if (alreadyOpen.data) {
          close();
          return {
            ok: true as const,
            data: {
              email: verified.data.account.email || controller.email,
              googleStillWorks: Boolean(verified.data.account.signInMethods?.google),
            },
          };
        }
        return {
          ok: true as const,
          data: {
            email: verified.data.account.email || controller.email,
            googleStillWorks: Boolean(verified.data.account.signInMethods?.google),
          },
        };
      } finally {
        if (
          operationGeneration.current === generation &&
          (!controller || accountCodeAccess.current === controller)
        ) {
          setBusyAction(null);
        }
      }
    },
    [clearReopenedError, close, isCurrentAccountCodeOperation],
  );

  const presentAccountCodePasswordResult = useCallback(
    async (
      result: AccountCodePasswordResult,
      generation: number,
      controller: AccountCodeAccessController,
    ): Promise<AccountCodePasswordActionResult> => {
      const cancelled = (): AccountCodePasswordActionResult => ({
        ok: false,
        error: { kind: 'request-failure', message: 'This request was cancelled.' },
        canRetryPassword: false,
        passwordStatus: controller.status,
      });
      if (!isCurrentAccountCodeOperation(generation, controller)) return cancelled();
      if (!result.ok) return result;

      let finalResult: AccountCodePasswordResult = result;
      let openAccount: OpenAccountSummary | null = null;
      if (finalResult.data.requiresAccountChoice) {
        openAccount = await currentOpenAccount();
        if (!isCurrentAccountCodeOperation(generation, controller)) return cancelled();
        if (!openAccount || openAccount.id === controller.targetAccountId) {
          finalResult = await controller.retryFinish();
          if (!isCurrentAccountCodeOperation(generation, controller)) return cancelled();
          if (!finalResult.ok) return finalResult;
        }
      }

      if (!finalResult.ok) return finalResult;
      if (finalResult.data.requiresAccountChoice) {
        openAccount = openAccount ?? (await currentOpenAccount());
        if (!isCurrentAccountCodeOperation(generation, controller)) return cancelled();
      }
      const presented: AccountCodePasswordActionResult = {
        ok: true,
        data: {
          ...finalResult.data,
          ...(openAccount ? { openAccount } : {}),
        },
      };
      if (finalResult.data.relationship === 'same') refreshTrackedBills();
      if (
        !finalResult.data.requiresAccountChoice &&
        finalResult.data.passwordStatus !== 'unknown'
      ) {
        close();
      }
      return presented;
    },
    [close, isCurrentAccountCodeOperation, refreshTrackedBills],
  );

  const onSaveAccountCodePassword = useCallback(
    async (password: string): Promise<AccountCodePasswordActionResult> => {
      const generation = operationGeneration.current;
      const controller = accountCodeAccess.current;
      clearReopenedError();
      setBusyAction('save-password');
      try {
        if (!controller) {
          return {
            ok: false,
            error: {
              kind: 'request-failure',
              message: 'We couldn’t finish signing you in. Try again.',
            },
            canRetryPassword: false,
            passwordStatus: 'not-started',
          };
        }
        const result = await controller.savePassword(password);
        if (!isCurrentAccountCodeOperation(generation, controller)) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This request was cancelled.' },
            canRetryPassword: false,
            passwordStatus: controller.status,
          };
        }
        return await presentAccountCodePasswordResult(result, generation, controller);
      } finally {
        if (
          operationGeneration.current === generation &&
          (!controller || accountCodeAccess.current === controller)
        ) {
          setBusyAction(null);
        }
      }
    },
    [clearReopenedError, isCurrentAccountCodeOperation, presentAccountCodePasswordResult],
  );

  const onRetryAccountCodeFinish =
    useCallback(async (): Promise<AccountCodePasswordActionResult> => {
      const generation = operationGeneration.current;
      const controller = accountCodeAccess.current;
      setBusyAction('finish-code');
      try {
        if (!controller) {
          return {
            ok: false,
            error: {
              kind: 'request-failure',
              message: 'We couldn’t finish signing you in. Try again.',
            },
            canRetryPassword: false,
            passwordStatus: 'unknown',
          };
        }
        const result = await controller.retryFinish();
        if (!isCurrentAccountCodeOperation(generation, controller)) {
          return {
            ok: false,
            error: { kind: 'request-failure', message: 'This request was cancelled.' },
            canRetryPassword: false,
            passwordStatus: controller.status,
          };
        }
        return await presentAccountCodePasswordResult(result, generation, controller);
      } finally {
        if (
          operationGeneration.current === generation &&
          (!controller || accountCodeAccess.current === controller)
        ) {
          setBusyAction(null);
        }
      }
    }, [isCurrentAccountCodeOperation, presentAccountCodePasswordResult]);

  const onKeepCurrentAccount = useCallback(async () => {
    if (accountChoiceRunning.current) return;
    const generation = operationGeneration.current;
    const controller = accountCodeAccess.current;
    if (!controller) return;
    accountChoiceRunning.current = true;
    setBusyAction('finish-code');
    await controller.keepCurrentAccount();
    if (!isCurrentAccountCodeOperation(generation, controller)) return;
    accountCodeAccess.current = null;
    close();
  }, [close, isCurrentAccountCodeOperation]);

  const onSwitchAccount = useCallback(async (): Promise<SignInDialogActionResult> => {
    if (accountChoiceRunning.current) {
      return {
        ok: false,
        error: {
          kind: 'request-failure',
          message: 'An account choice is already in progress.',
        },
      };
    }
    const generation = operationGeneration.current;
    accountChoiceRunning.current = true;
    setBusyAction('switch-account');
    const controller = accountCodeAccess.current;
    if (!controller) {
      accountChoiceRunning.current = false;
      setBusyAction(null);
      return {
        ok: false,
        error: {
          kind: 'request-failure',
          message: 'We couldn’t switch accounts. Check your connection and try again.',
        },
      };
    }
    const result = await controller.switchAccount();
    if (!isCurrentAccountCodeOperation(generation, controller)) {
      return {
        ok: false,
        error: { kind: 'request-failure', message: 'This request was cancelled.' },
      };
    }
    if (result.ok) {
      accountCodeAccess.current = null;
      close();
      return { ok: true };
    }
    accountChoiceRunning.current = false;
    setBusyAction(null);
    return result;
  }, [close, isCurrentAccountCodeOperation]);

  const onCancelAccountCode = useCallback(async (nextScreen: SignInDialogScreen) => {
    if (nextScreen === 'sign-in') requestedAccountScreenOpen.current = false;
    const generation = operationGeneration.current + 1;
    operationGeneration.current = generation;
    accountCodeStarting.current = null;
    accountChoiceRunning.current = false;
    const controller = accountCodeAccess.current;
    accountCodeAccess.current = null;
    if (controller) {
      accountCodeCleanup.current = controller.dispose().catch(() => undefined);
    }
    await accountCodeCleanup.current;
    if (operationGeneration.current === generation) setBusyAction(null);
  }, []);

  // Signing in anywhere — including a second tab — closes the dialog. When this
  // tab came back from a Track request, finish that exact idempotent write first.
  const authWasSignedIn = useRef(isSignedIn);
  useEffect(() => {
    const justSignedIn = isSignedIn && !authWasSignedIn.current;
    authWasSignedIn.current = isSignedIn;
    if (
      accountCodeStarting.current !== null ||
      accountCodeAccess.current ||
      ordinarySignInStarting.current !== null ||
      passwordSignInAccess.current
    ) {
      return;
    }
    // An expired email link explicitly asked for Create or Recover. Let that
    // destination win over an account being restored in the background.
    if (requestedAccountScreenOpen.current) return;
    const ordinaryJustSettled = ordinaryCompletionRequested.current;
    if (!isSignedIn || (!justSignedIn && !pendingRequest.current && !ordinaryJustSettled)) return;
    ordinaryCompletionRequested.current = false;
    const request = pendingRequest.current;
    const signedInToken = accessToken;
    if (
      ordinaryCompletion.current?.request === request &&
      ordinaryCompletion.current.accessToken === signedInToken
    ) {
      return;
    }
    const completion = { request, accessToken: signedInToken };
    ordinaryCompletion.current = completion;
    const generation = operationGeneration.current + 1;
    operationGeneration.current = generation;
    signInAttemptGate.reset();
    setBusyAction(null);
    const stillCurrent = () =>
      operationGeneration.current === generation &&
      pendingRequest.current === request &&
      accessTokenRef.current === signedInToken;
    const releaseCompletion = () => {
      if (ordinaryCompletion.current === completion) ordinaryCompletion.current = null;
    };
    const finishSignedInRequest = () => {
      if (!stillCurrent()) return () => {};
      pendingRequest.current = null;
      clearPendingSignIn();
      const stopRestoringScroll = restoreScrollPosition(request?.scrollY);
      dispatch({ type: 'close' });
      return stopRestoringScroll;
    };
    if (request?.pendingCompletion === 'email-link') {
      const cleanup = finishSignedInRequest();
      releaseCompletion();
      return cleanup;
    }
    void completeOrdinaryPending(signedInToken, request)
      .then(() => {
        if (!stillCurrent()) return;
        refreshTrackedBills();
        finishSignedInRequest();
      })
      .catch((error) => {
        if (!stillCurrent()) return;
        if (error instanceof ApiError && error.status === 410) {
          finishSignedInRequest();
          return;
        }
        dispatch({ type: 'fail', kind: 'failed' });
      })
      .finally(releaseCompletion);
  }, [
    accessToken,
    completeOrdinaryPending,
    isSignedIn,
    ordinaryCompletionTick,
    refreshTrackedBills,
    signInAttemptGate,
  ]);

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
    if (
      isLoading ||
      state.open ||
      !canOpenRequestedSignInScreen(requestedScreen.current, isSignedIn)
    ) {
      return;
    }
    requestedScreen.current = undefined;
    dispatch({ type: 'open', request: pendingRequest.current ?? { intent: 'nav' } });
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
        ordinaryAccountOpen={isSignedIn}
        onClose={close}
        onGoogle={onContinue}
        onPasswordSignIn={onPasswordSignIn}
        onRequestAccountCode={onRequestAccountCode}
        onVerifyAccountCode={onVerifyAccountCode}
        onSaveAccountCodePassword={onSaveAccountCodePassword}
        onRetryAccountCodeFinish={onRetryAccountCodeFinish}
        onKeepCurrentAccount={onKeepCurrentAccount}
        onSwitchAccount={onSwitchAccount}
        onCancelAccountCode={onCancelAccountCode}
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
