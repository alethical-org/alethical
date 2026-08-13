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
import { normalizeEmail } from '../lib/auth/rev9Auth';
import {
  signOutLocallyAndVerify,
  validationFailureRevokesSession,
} from '../lib/auth/sessionSafety';
import { restoreAuthSession } from '../lib/authRestore';
import { SIGN_IN_ERROR_MESSAGES, SignInErrorKind, signInErrorKind } from '../lib/signIn';
import { clearStoredSupabaseSession, isSupabaseConfigured, supabase } from '../lib/supabase';

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
  signInWithPassword: (email: string, password: string) => Promise<AuthOperationResult<unknown>>;
  createAccount: (
    email: string,
    password: string,
    confirmationUrl: string,
  ) => Promise<AuthOperationResult<{ signedIn: boolean }>>;
  resendConfirmation: (email: string, confirmationUrl: string) => Promise<AuthOperationResult>;
  sendPasswordReset: (email: string, resetUrl: string) => Promise<AuthOperationResult>;
  setPassword: (password: string) => Promise<AuthOperationResult>;
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
  if (kind === 'match-failed') return 'match-failed';
  return 'failed';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorKind, setAuthErrorKind] = useState<SignInErrorKind | null>(null);
  const validations = useRef(new Map<string, Promise<AuthOperationResult<AuthUser>>>());
  const validationGeneration = useRef(0);

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
      if (result.ok) {
        setSession(candidate);
        setUser(result.data);
        clearAuthError();
        setIsLoading(false);
        return result;
      }
      if (validationFailureRevokesSession(result.error.kind)) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        await clearStoredSupabaseSession();
      }
      setSession(null);
      setUser(null);
      failWith(result.error.message, publicErrorKind(result.error.kind));
      setIsLoading(false);
      return result;
    },
    [clearAuthError, failWith],
  );

  useEffect(
    () =>
      onAccountDeactivated(() => {
        validationGeneration.current += 1;
        void supabase.auth.signOut({ scope: 'local' }).finally(() => {
          void clearStoredSupabaseSession();
          setSession(null);
          setUser(null);
          failWith(SIGN_IN_ERROR_MESSAGES.deactivated, 'deactivated');
        });
      }),
    [failWith],
  );

  useEffect(() => {
    let mounted = true;
    void restoreAuthSession<Session>(() => supabase.auth.getSession())
      .then(async ({ session: restoredSession, errorMessage }) => {
        if (!mounted) return;
        if (errorMessage) {
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return;
        }
        if (restoredSession) await acceptSession(restoredSession);
      })
      .catch(() => {
        if (mounted) failWith(SIGN_IN_ERROR_MESSAGES.failed);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        validationGeneration.current += 1;
        setSession(null);
        setUser(null);
        setIsLoading(false);
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
        const callbackError =
          getCallbackParam(result.url, 'error_description') ??
          getCallbackParam(result.url, 'error');
        if (callbackError) {
          failWith(
            SIGN_IN_ERROR_MESSAGES[signInErrorKind(getCallbackParam(result.url, 'error'))],
            signInErrorKind(getCallbackParam(result.url, 'error')),
          );
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
      signInWithPassword: async (email: string, password: string) => {
        const normalized = normalizeEmail(email);
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalized,
          password,
        });
        if (error || !data.session) return authFailure(error, normalized);
        return acceptSession(data.session);
      },
      createAccount: async (email: string, password: string, confirmationUrl: string) => {
        const normalized = normalizeEmail(email);
        const { data, error } = await supabase.auth.signUp({
          email: normalized,
          password,
          options: { emailRedirectTo: confirmationUrl },
        });
        if (error) return authFailure(error, normalized);
        if (data.session) {
          const accepted = await acceptSession(data.session);
          if (!accepted.ok) return accepted;
        }
        return authSuccess({ signedIn: Boolean(data.session) });
      },
      resendConfirmation: async (email: string, confirmationUrl: string) => {
        const normalized = normalizeEmail(email);
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: normalized,
          options: { emailRedirectTo: confirmationUrl },
        });
        return error ? authFailure(error, normalized) : authSuccess();
      },
      sendPasswordReset: async (email: string, resetUrl: string) => {
        const normalized = normalizeEmail(email);
        const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
          redirectTo: resetUrl,
        });
        return error ? authFailure(error, normalized) : authSuccess();
      },
      setPassword: async (password: string) => {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return authFailure(error, user?.email);
        if (user?.signInMethods) {
          setUser({
            ...user,
            signInMethods: { ...user.signInMethods, password: true },
          });
        }
        return authSuccess();
      },
      signOut: async () => {
        clearAuthError();
        validationGeneration.current += 1;
        const result = await signOutLocallyAndVerify(supabase.auth);
        if (!result.signedOut) {
          const failure = authFailure(result.error);
          failWith(SIGN_IN_ERROR_MESSAGES.failed);
          return failure;
        }
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
