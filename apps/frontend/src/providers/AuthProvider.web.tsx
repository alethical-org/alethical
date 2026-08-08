import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/auth-js';

import { onAccountDeactivated } from '../data/api';
import { restoreAuthSession } from '../lib/authRestore';
import { SIGN_IN_ERROR_MESSAGES, SignInErrorKind } from '../lib/signIn';
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
  return new URL(
    returnTo ?? `${window.location.pathname}${window.location.search}`,
    window.location.origin,
  ).toString();
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorKind, setAuthErrorKind] = useState<SignInErrorKind | null>(null);

  const failWith = useCallback((message: string, kind: SignInErrorKind = 'failed') => {
    setAuthError(message);
    setAuthErrorKind(kind);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
    setAuthErrorKind(null);
  }, []);

  useEffect(
    () =>
      onAccountDeactivated(() => {
        void supabase.auth.signOut().finally(() => {
          setSession(null);
          failWith(SIGN_IN_ERROR_MESSAGES.deactivated, 'deactivated');
        });
      }),
    [failWith],
  );

  useEffect(() => {
    let mounted = true;

    void restoreAuthSession<Session>(() => supabase.auth.getSession())
      .then(({ session: restoredSession, errorMessage }) => {
        if (!mounted) {
          return;
        }
        setSession(restoredSession);
        if (errorMessage) {
          failWith(errorMessage);
        }
      })
      .catch((error) => {
        if (mounted) {
          setSession(null);
          failWith(error instanceof Error ? error.message : 'Sign-in could not be restored.');
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
      if (nextSession) {
        clearAuthError();
      }
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

        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: getRedirectTo(returnTo),
            skipBrowserRedirect: false,
          },
        });

        if (error) {
          failWith(error.message);
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
