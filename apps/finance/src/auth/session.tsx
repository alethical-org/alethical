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

export type SessionStatus = 'loading' | 'checking' | AccessState;

export interface FinanceSession {
  status: SessionStatus;
  email: string | null;
  accessToken: string | null;
  supabase: SupabaseClient;
  apiBaseUrl: string;
  googleSignIn: boolean;
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
  children,
}: {
  supabase: SupabaseClient;
  apiBaseUrl: string;
  googleSignIn?: boolean;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [attempt, setAttempt] = useState(0);
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

  const token = session?.access_token ?? null;

  useEffect(() => {
    if (session === undefined) return;
    const request = ++latest.current;
    if (!token) {
      setStatus('signed-out');
      return;
    }
    setStatus('checking');
    checkAccess(apiBaseUrl, token).then((result) => {
      if (request === latest.current) setStatus(result);
    });
  }, [apiBaseUrl, session, token, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'local' });
  }, [supabase]);

  const value = useMemo<FinanceSession>(
    () => ({
      status,
      email: session?.user.email ?? null,
      accessToken: token,
      supabase,
      apiBaseUrl,
      googleSignIn,
      retry,
      signOut,
    }),
    [apiBaseUrl, googleSignIn, retry, session, signOut, status, supabase, token],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
