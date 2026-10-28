import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { checkAccess, type AccessState } from '../api/client';
import { STORAGE_KEY } from './supabase';

export type SessionStatus = 'loading' | 'checking' | AccessState;

interface Answer {
  userId: string | null;
  status: SessionStatus;
}

export interface FinanceSession {
  status: SessionStatus;
  email: string | null;
  accessToken: string | null;
  supabase: SupabaseClient;
  apiBaseUrl: string;
  googleSignIn: boolean;
  emailSignIn: boolean;
  /** True while Try again re-asks; the last answer stays on screen meanwhile. */
  retrying: boolean;
  retry: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<FinanceSession | null>(null);

export function useFinanceSession(): FinanceSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useFinanceSession needs a SessionProvider');
  return value;
}

/**
 * Holds the Supabase session and asks the server whether it has Finance access
 * every time the account or its token changes. A slower answer for an earlier
 * token never replaces the answer for the current one.
 */
export function SessionProvider({
  supabase,
  apiBaseUrl,
  googleSignIn = false,
  emailSignIn = false,
  children,
}: {
  supabase: SupabaseClient;
  apiBaseUrl: string;
  googleSignIn?: boolean;
  emailSignIn?: boolean;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const loaded = session !== undefined;
  const token = session?.access_token ?? null;
  const userId = session?.user.id ?? null;

  // Supabase hands over a fresh copy of the same session when a hidden tab
  // returns, and a new token every hour; only a new token or account re-asks.
  useEffect(() => {
    if (!loaded) return;
    if (!token) {
      // A later sign-in, even by the same account, is checked from scratch.
      latest.current += 1;
      setAnswer(null);
      return;
    }
    const request = ++latest.current;
    checkAccess(apiBaseUrl, token).then((result) => {
      if (request !== latest.current) return;
      setRetrying(false);
      setAnswer((previous) =>
        // A failed re-check for the same account keeps its last answer: the
        // server refuses every request it should, whatever this page shows.
        result === 'unavailable' &&
        previous?.userId === userId &&
        (previous.status === 'granted' || previous.status === 'no-access')
          ? previous
          : { userId, status: result },
      );
    });
  }, [apiBaseUrl, attempt, loaded, token, userId]);

  const status: SessionStatus = !loaded
    ? 'loading'
    : !token
      ? 'signed-out'
      : answer && answer.userId === userId
        ? answer.status
        : 'checking';

  const retry = useCallback(() => {
    setRetrying(true);
    setAttempt((value) => value + 1);
  }, []);
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      // Signing out locally can fail offline with an expired token; the saved
      // session must still leave this browser.
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage can be unavailable; the session below is cleared either way.
      }
      setSession(null);
    }
  }, [supabase]);

  const value = useMemo<FinanceSession>(
    () => ({
      status,
      email: session?.user.email ?? null,
      accessToken: token,
      supabase,
      apiBaseUrl,
      googleSignIn,
      emailSignIn,
      retrying,
      retry,
      signOut,
    }),
    [
      apiBaseUrl,
      emailSignIn,
      googleSignIn,
      retry,
      retrying,
      session,
      signOut,
      status,
      supabase,
      token,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
