import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';

import { onAccountDeactivated } from '../data/api';
import {
  AuthOperationResult,
  AuthUser,
  authFailure,
  authSuccess,
  validateAlethicalSession,
} from '../lib/auth/operations';
import { savePasswordWithFreshProof } from '../lib/auth/passwordFreshProof';
import {
  isProviderSessionRejected,
  onProviderSessionRejected,
  providerSessionIdentity,
  rejectProviderSession,
  sameProviderSessionLineage,
  sessionMatchesProviderUserAccessToken,
  sessionMatchesOpeningAccessToken,
} from '../lib/auth/providerSessionAcceptance';
import { validationFailureRevokesSession } from '../lib/auth/sessionSafety';
import { restoreAuthSession } from '../lib/authRestore';
import {
  SIGN_IN_ERROR_MESSAGES,
  SignInErrorKind,
  signInErrorKindFromCallback,
} from '../lib/signIn';
import {
  clearOrdinarySessionIfUnchanged,
  isSupabaseConfigured,
  passwordClientForOrdinarySession,
  signOutOrdinarySessionIfUnchanged,
  supabase,
} from '../lib/supabase';

interface AuthContextValue {
  isLoading: boolean;
  isSignedIn: boolean;
  mode: 'supabase';
  user: AuthUser | null;
  accessToken: string | null;
  authError: string | null;
  authErrorKind: SignInErrorKind | null;
  dismissAuthError: () => void;
  signInWithGoogle: (returnTo?: string) => Promise<AuthOperationResult<unknown>>;
  setPassword: (
    password: string,
    freshProofCode?: string,
    expectedAccessToken?: string,
  ) => Promise<AuthOperationResult>;
  signOut: () => Promise<AuthOperationResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getRedirectTo(returnTo?: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return new URL(
      returnTo ?? `${window.location.pathname}${window.location.search}`,
      window.location.origin,
    ).toString();
  }
  return AuthSession.makeRedirectUri({ scheme: 'alethical', path: 'auth/callback' });
}

function getCallbackParam(callbackUrl: string, paramName: string) {
  try {
    return new URL(callbackUrl).searchParams.get(paramName);
  } catch {
    const match = callbackUrl.match(new RegExp(`[?&]${paramName}=([^&]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function publicErrorKind(kind: string): SignInErrorKind {
  if (kind === 'deactivated') return 'deactivated';
  if (kind === 'unverified-google') return 'unverified-google';
  return 'failed';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorKind, setAuthErrorKind] = useState<SignInErrorKind | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const validations = useRef(new Map<string, Promise<AuthOperationResult<AuthUser>>>());
  const validationGeneration = useRef(0);
  const passwordChange = useRef<{
    openingAccessToken: string;
    auth: ReturnType<typeof passwordClientForOrdinarySession>;
  } | null>(null);

  const failWith = useCallback((message: string, kind: SignInErrorKind = 'failed') => {
    setAuthError(message);
    setAuthErrorKind(kind);
  }, []);
  const clearAuthError = useCallback(() => {
    setAuthError(null);
    setAuthErrorKind(null);
  }, []);

  const acceptSession = useCallback(
    async (candidate: Session): Promise<AuthOperationResult<AuthUser>> => {
      if (isProviderSessionRejected(candidate)) return authFailure(null);
      const generation = ++validationGeneration.current;
      setIsLoading(true);
      let validation = validations.current.get(candidate.access_token);
      if (!validation) {
        validation = validateAlethicalSession(candidate);
        validations.current.set(candidate.access_token, validation);
      }
      const result = await validation;
      validations.current.delete(candidate.access_token);
      if (generation !== validationGeneration.current) return authFailure(null);
      if (isProviderSessionRejected(candidate)) {
        setIsLoading(false);
        return authFailure(null);
      }
      const current = await supabase.auth.getSession().catch(() => null);
      if (generation !== validationGeneration.current) return authFailure(null);
      const currentSession = current && !current.error ? current.data.session : null;
      if (currentSession && isProviderSessionRejected(currentSession)) {
        setIsLoading(false);
        return authFailure(null);
      }
      if (!sameProviderSessionLineage(currentSession, candidate)) {
        setIsLoading(false);
        return authFailure(null);
      }
      if (result.ok) {
        sessionRef.current = currentSession;
        setSession(currentSession);
        setUser(result.data);
        clearAuthError();
        setIsLoading(false);
        return result;
      }
      failWith(result.error.message, publicErrorKind(result.error.kind));
      if (validationFailureRevokesSession(result.error.kind)) rejectProviderSession(candidate);
      await clearOrdinarySessionIfUnchanged(candidate).catch(() => false);
      if (generation !== validationGeneration.current) return result;
      if (sessionRef.current && !sameProviderSessionLineage(sessionRef.current, candidate)) {
        return result;
      }
      sessionRef.current = null;
      setSession(null);
      setUser(null);
      setIsLoading(false);
      return result;
    },
    [clearAuthError, failWith],
  );

  useEffect(
    () =>
      onProviderSessionRejected((rejectedSessionKey) => {
        if (
          !sessionRef.current ||
          providerSessionIdentity(sessionRef.current) !== rejectedSessionKey
        ) {
          return;
        }
        sessionRef.current = null;
        setSession(null);
        setUser(null);
        setIsLoading(false);
      }),
    [],
  );

  useEffect(
    () =>
      onAccountDeactivated((requestAccessToken) => {
        void (async () => {
          let removedMatchingSession = false;
          let storedBelongsToDifferentAccount = false;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const current = await supabase.auth.getSession().catch(() => null);
            const stored = current && !current.error ? current.data.session : null;
            if (!stored) {
              break;
            }
            if (!sessionMatchesProviderUserAccessToken(stored, requestAccessToken)) {
              storedBelongsToDifferentAccount = true;
              break;
            }
            rejectProviderSession(stored);
            const cleared = await clearOrdinarySessionIfUnchanged(stored).catch(() => false);
            removedMatchingSession ||= cleared;
          }

          const visible = sessionRef.current;
          const visibleMatches = Boolean(
            visible && sessionMatchesProviderUserAccessToken(visible, requestAccessToken),
          );
          const visibleBelongsToDifferentAccount = Boolean(visible && !visibleMatches);
          if (visible && visibleMatches) {
            rejectProviderSession(visible);
            sessionRef.current = null;
            setSession(null);
            setUser(null);
          }
          if (
            !storedBelongsToDifferentAccount &&
            !visibleBelongsToDifferentAccount &&
            (removedMatchingSession || visibleMatches)
          ) {
            setIsLoading(false);
            failWith(SIGN_IN_ERROR_MESSAGES.deactivated, 'deactivated');
          }
        })();
      }),
    [failWith],
  );

  useEffect(() => {
    let mounted = true;
    const restoreGeneration = ++validationGeneration.current;
    void restoreAuthSession<Session>(() => supabase.auth.getSession())
      .then(async ({ session: restoredSession, errorMessage }) => {
        if (!mounted || restoreGeneration !== validationGeneration.current) return;
        if (errorMessage) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return;
        }
        if (restoredSession) await acceptSession(restoredSession);
      })
      .catch(() => {
        if (mounted && restoreGeneration === validationGeneration.current) {
          sessionRef.current = null;
          setSession(null);
          setUser(null);
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
        }
      })
      .finally(() => {
        if (mounted && restoreGeneration === validationGeneration.current) setIsLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        const generation = ++validationGeneration.current;
        void supabase.auth
          .getSession()
          .then((current) => {
            if (generation !== validationGeneration.current) return;
            if (!current.error && current.data.session) {
              void acceptSession(current.data.session);
              return;
            }
            sessionRef.current = null;
            setSession(null);
            setUser(null);
            setIsLoading(false);
          })
          .catch(() => {
            if (generation !== validationGeneration.current) return;
            sessionRef.current = null;
            setSession(null);
            setUser(null);
            failWith(SIGN_IN_ERROR_MESSAGES.failed);
            setIsLoading(false);
          });
        return;
      }
      void acceptSession(nextSession);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [acceptSession, failWith]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isSignedIn: Boolean(session?.access_token && user),
      mode: 'supabase',
      user,
      accessToken: session?.access_token ?? null,
      authError,
      authErrorKind,
      dismissAuthError: clearAuthError,
      signInWithGoogle: async (returnTo?: string) => {
        clearAuthError();
        if (!isSupabaseConfigured) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return authFailure(null);
        }
        const redirectTo = getRedirectTo(returnTo);
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
        });
        if (error) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return authFailure(error);
        }
        if (Platform.OS === 'web') return authSuccess();
        if (!data.url) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return authFailure(null);
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') {
          failWith(SIGN_IN_ERROR_MESSAGES.cancelled, 'cancelled');
          return {
            ok: false,
            error: { kind: 'request-failure', message: SIGN_IN_ERROR_MESSAGES.cancelled },
          };
        }
        const callbackKind = signInErrorKindFromCallback(result.url);
        if (callbackKind) {
          failWith(SIGN_IN_ERROR_MESSAGES[callbackKind], callbackKind);
          return authFailure(null);
        }
        const authCode = getCallbackParam(result.url, 'code');
        if (!authCode) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return authFailure(null);
        }
        const exchanged = await supabase.auth.exchangeCodeForSession(authCode);
        if (exchanged.error || !exchanged.data.session) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return authFailure(exchanged.error);
        }
        return acceptSession(exchanged.data.session);
      },
      setPassword: async (
        password: string,
        freshProofCode?: string,
        expectedAccessToken?: string,
      ) => {
        const visibleSession = sessionRef.current;
        if (
          !visibleSession ||
          !expectedAccessToken ||
          !sessionMatchesOpeningAccessToken(visibleSession, expectedAccessToken)
        ) {
          passwordChange.current = null;
          return authFailure({ code: 'session_changed' }, user?.email);
        }
        if (!freshProofCode) {
          passwordChange.current = {
            openingAccessToken: expectedAccessToken,
            auth: passwordClientForOrdinarySession(visibleSession),
          };
        }
        const flow = passwordChange.current;
        if (!flow || flow.openingAccessToken !== expectedAccessToken) {
          return authFailure({ code: 'session_changed' }, user?.email);
        }
        const result = await savePasswordWithFreshProof(
          flow.auth,
          password,
          freshProofCode,
          user?.email,
        );
        if (result.ok || result.error.kind !== 'fresh-proof') passwordChange.current = null;
        if (!result.ok) return result;
        setUser((current) => {
          if (!current || current.id !== user?.id || !current.signInMethods) return current;
          return {
            ...current,
            signInMethods: { ...current.signInMethods, password: true },
          };
        });
        return result;
      },
      signOut: async () => {
        clearAuthError();
        const openingSession = sessionRef.current;
        if (!openingSession) return authSuccess();
        const generation = ++validationGeneration.current;
        const result = await signOutOrdinarySessionIfUnchanged(openingSession);
        if (result.error) {
          const failure = authFailure(result.error);
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return failure;
        }
        if (generation !== validationGeneration.current) return authSuccess();
        const current = await supabase.auth.getSession().catch(() => null);
        if (generation !== validationGeneration.current) return authSuccess();
        if (current && !current.error && current.data.session) {
          void acceptSession(current.data.session);
          return authSuccess();
        }
        sessionRef.current = null;
        setSession(null);
        setUser(null);
        return authSuccess();
      },
    }),
    [acceptSession, authError, authErrorKind, clearAuthError, failWith, isLoading, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
