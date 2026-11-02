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
import { clearReadCache } from '../api/read';
import { clearDrafts, setDraftAccount } from '../ui/drafts';
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
  /** Whether the signed-in screens are on (`VITE_FINANCE_SCREENS`); without
   * them a listed account returns to the landing page instead of Finance Home. */
  screens: boolean;
  /** True while Try again re-asks; the last answer stays on screen meanwhile. */
  retrying: boolean;
  /** This account had access in this session and the server now refuses it:
   * the results and drafts it held are cleared and no longer shown. */
  revoked: boolean;
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
  screens = false,
  children,
}: {
  supabase: SupabaseClient;
  apiBaseUrl: string;
  googleSignIn?: boolean;
  emailSignIn?: boolean;
  screens?: boolean;
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
  const [revoked, setRevoked] = useState(false);

  // Drafts and held answers belong to 1 account: signing in as another
  // account clears what the browser held for the last one (Access lifecycle).
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !userId) return;
    if (lastUser.current !== null && lastUser.current !== userId) clearReadCache();
    lastUser.current = userId;
    setDraftAccount(userId);
  }, [loaded, userId]);

  // Supabase hands over a fresh copy of the same session when a hidden tab
  // returns, and a new token every hour; only a new token or account re-asks.
  useEffect(() => {
    if (!loaded) return;
    if (!token) {
      // A later sign-in, even by the same account, is checked from scratch.
      latest.current += 1;
      setAnswer(null);
      setRevoked(false);
      return;
    }
    const request = ++latest.current;
    checkAccess(apiBaseUrl, token).then((result) => {
      if (request !== latest.current) return;
      setRetrying(false);
      setAnswer((previous) => {
        const sameAccount = previous !== null && previous.userId === userId;
        // Access held in this session and now refused: results kept from this
        // account are no longer shown, and its unfinished entries are gone.
        if (result === 'no-access' && sameAccount && previous.status === 'granted') {
          clearReadCache();
          clearDrafts();
          setRevoked(true);
        }
        // A failed re-check for the same account keeps its last answer: the
        // server refuses every request it should, whatever this page shows.
        if (
          result === 'unavailable' &&
          sameAccount &&
          (previous.status === 'granted' || previous.status === 'no-access')
        ) {
          return previous;
        }
        return { userId, status: result };
      });
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
      screens,
      retrying,
      revoked,
      retry,
      signOut,
    }),
    [
      apiBaseUrl,
      emailSignIn,
      googleSignIn,
      retry,
      retrying,
      revoked,
      screens,
      session,
      signOut,
      status,
      supabase,
      token,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
