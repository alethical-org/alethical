import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Session } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '../lib/supabase';

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

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return;
      }
      if (error) {
        setAuthError(error.message);
      }
      setSession(data.session);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
      setAuthError(null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isSignedIn: Boolean(session?.access_token),
      mode: 'supabase',
      user: userFromSession(session),
      accessToken: session?.access_token ?? null,
      authError,
      signInWithGoogle: async (returnTo?: string) => {
        setAuthError(null);

        if (!isSupabaseConfigured) {
          setAuthError('Supabase is not configured for this app environment.');
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
          setAuthError(error.message);
          return;
        }

        if (Platform.OS === 'web') {
          return;
        }

        if (!data.url) {
          setAuthError('Supabase did not return a Google sign-in URL.');
          return;
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') {
          return;
        }

        const callbackError =
          getCallbackParam(result.url, 'error_description') ??
          getCallbackParam(result.url, 'error');
        if (callbackError) {
          setAuthError(callbackError);
          return;
        }

        const authCode = getCallbackParam(result.url, 'code');
        if (!authCode) {
          setAuthError('Supabase did not return an auth code.');
          return;
        }

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
        if (exchangeError) {
          setAuthError(exchangeError.message);
        }
      },
      signOut: async () => {
        setAuthError(null);
        const { error } = await supabase.auth.signOut();
        if (error) {
          setAuthError(error.message);
          return;
        }
        setSession(null);
      },
    }),
    [authError, isLoading, session],
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
