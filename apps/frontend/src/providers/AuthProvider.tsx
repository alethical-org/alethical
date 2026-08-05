import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Session } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { SignInErrorKind, signInErrorKind } from '../lib/signIn';

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  isLoading: boolean;
  isSignedIn: boolean;
  mode: 'supabase';
  user: AuthUser | null;
  accessToken: string | null;
  authError: string | null;
  /**
   * Whether the last failure was the person backing out of Google or something
   * actually going wrong. The sign-in dialog words the two differently, and the
   * raw provider message can't tell them apart.
   */
  authErrorKind: SignInErrorKind | null;
  signInWithGoogle: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromSession(session: Session | null): AuthUser | null {
  const user = session?.user;
  if (!user) {
    return null;
  }

  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  const email = user.email ?? '';

  return {
    id: user.id,
    name:
      typeof metadataName === 'string' && metadataName.trim()
        ? metadataName
        : email.split('@')[0] || 'Signed-in user',
    email,
  };
}

function getRedirectTo(returnTo?: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return new URL(
      returnTo ?? `${window.location.pathname}${window.location.search}`,
      window.location.origin,
    ).toString();
  }

  return AuthSession.makeRedirectUri({
    scheme: 'alethical',
    path: 'auth/callback',
  });
}

function getCallbackParam(callbackUrl: string, paramName: string) {
  try {
    return new URL(callbackUrl).searchParams.get(paramName);
  } catch {
    const match = callbackUrl.match(new RegExp(`[?&]${paramName}=([^&]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorKind, setAuthErrorKind] = useState<SignInErrorKind | null>(null);

  // Every failure path sets both, so a caller never has to guess the kind from
  // the wording of a provider message.
  const failWith = useCallback((message: string, kind: SignInErrorKind = 'failed') => {
    setAuthError(message);
    setAuthErrorKind(kind);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
    setAuthErrorKind(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return;
      }
      if (error) {
        failWith(error.message);
      }
      setSession(data.session);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
      clearAuthError();
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [clearAuthError, failWith]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isSignedIn: Boolean(session?.access_token),
      mode: 'supabase',
      user: userFromSession(session),
      accessToken: session?.access_token ?? null,
      authError,
      authErrorKind,
      signInWithGoogle: async (returnTo?: string) => {
        clearAuthError();

        if (!isSupabaseConfigured) {
          failWith('Supabase is not configured for this app environment.');
          return;
        }

        const redirectTo = getRedirectTo(returnTo);
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: Platform.OS !== 'web',
          },
        });

        if (error) {
          failWith(error.message);
          return;
        }

        if (Platform.OS === 'web') {
          return;
        }

        if (!data.url) {
          failWith('Supabase did not return a Google sign-in URL.');
          return;
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        // Dismissing the Google sheet used to return here silently, which left
        // anything waiting on the result — the sign-in dialog — spinning forever.
        if (result.type !== 'success') {
          failWith('The Google sign-in window closed before sign-in finished.', 'cancelled');
          return;
        }

        const callbackError =
          getCallbackParam(result.url, 'error_description') ??
          getCallbackParam(result.url, 'error');
        if (callbackError) {
          failWith(
            callbackError,
            signInErrorKind(getCallbackParam(result.url, 'error') ?? callbackError),
          );
          return;
        }

        const authCode = getCallbackParam(result.url, 'code');
        if (!authCode) {
          failWith('Supabase did not return an auth code.');
          return;
        }

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
        if (exchangeError) {
          failWith(exchangeError.message);
        }
      },
      signOut: async () => {
        clearAuthError();
        const { error } = await supabase.auth.signOut();
        if (error) {
          failWith(error.message);
          return;
        }
        setSession(null);
      },
    }),
    [authError, authErrorKind, clearAuthError, failWith, isLoading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
