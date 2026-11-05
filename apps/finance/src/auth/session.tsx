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

import { checkAccess, signOutResearch, type AccessState } from '../api/client';
import { clearReadCache } from '../api/read';
import { clearDrafts, setDraftAccount } from '../ui/drafts';
import { STORAGE_KEY } from './supabase';
import {
  readResearchSession,
  saveResearchSession,
  RESEARCH_SESSION_KEY,
  type ResearchSession,
} from './researchSession';

export type SessionStatus = 'loading' | 'checking' | AccessState;

interface Answer {
  userId: string | null;
  status: SessionStatus;
}

export interface FinanceSession {
  status: SessionStatus;
  canEdit: boolean;
  startResearchSession: (session: ResearchSession) => Promise<void>;
  /** Explicit Google/code sign-in, distinct from automatic auth refresh events. */
  beginOrdinarySignIn: () => void;
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
  const [initial] = useState(() => {
    const research = readResearchSession();
    let hadResearch = research !== null;
    try {
      hadResearch ||= window.localStorage.getItem(RESEARCH_SESSION_KEY) !== null;
    } catch {
      /* Storage may be unavailable. */
    }
    return { research, hadResearch };
  });
  const [session, setSession] = useState<Session | null | undefined>(
    initial.hadResearch ? null : undefined,
  );
  const [research, setResearch] = useState<ResearchSession | null>(initial.research);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const latest = useRef(0);
  // These refs change synchronously, before React renders or an auth promise settles.
  const authGeneration = useRef(0);
  const researchRef = useRef(research);
  const ordinarySessionRef = useRef(session);
  const ordinaryEventsEnabled = useRef(!initial.hadResearch);

  const replaceResearch = useCallback((next: ResearchSession | null, persist = true) => {
    authGeneration.current += 1;
    latest.current += 1;
    researchRef.current = next;
    ordinaryEventsEnabled.current = false;
    setResearch(next);
    ordinarySessionRef.current = null;
    setSession(null);
    setAnswer(null);
    setRetrying(false);
    clearReadCache();
    clearDrafts();
    if (persist) saveResearchSession(next);
    try {
      // On a local start, let Supabase read its old session for local logout.
      if (!next || !persist) window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory ordinary session is already gone when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (initial.hadResearch && !initial.research) {
      // Expired saved research must not reveal an ordinary account underneath it.
      saveResearchSession(null);
      clearReadCache();
      clearDrafts();
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* no storage */
      }
    }
    const generation = authGeneration.current;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (
          active &&
          generation === authGeneration.current &&
          ordinaryEventsEnabled.current &&
          !researchRef.current
        ) {
          ordinarySessionRef.current = data.session;
          setSession(data.session);
        }
      })
      .catch(() => {
        if (
          active &&
          generation === authGeneration.current &&
          ordinaryEventsEnabled.current &&
          !researchRef.current
        ) {
          ordinarySessionRef.current = null;
          setSession(null);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // A Supabase refresh or initial event belongs to the ordinary account. It
      // must never replace research, or sit behind it waiting to be restored.
      if (!active || researchRef.current) return;
      if (!ordinaryEventsEnabled.current) return;
      authGeneration.current += 1;
      const previous = ordinarySessionRef.current;
      if (previous?.access_token !== next?.access_token || previous?.user.id !== next?.user.id)
        latest.current += 1;
      ordinarySessionRef.current = next;
      setSession(next);
      if (!next) setAnswer(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase, initial]);

  const loaded = research !== null || session !== undefined;
  const token = research?.access_token ?? session?.access_token ?? null;
  const userId = research ? `research:${research.email}` : (session?.user.id ?? null);
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
      if (research && (result === 'signed-out' || result === 'no-access')) {
        replaceResearch(null);
        setRevoked(true);
        return;
      }
      setAnswer((previous) => {
        const sameAccount = previous !== null && previous.userId === userId;
        // Access held in this session and now refused: results kept from this
        // account are no longer shown, and its unfinished entries are gone.
        if (
          (result === 'no-access' || result === 'signed-out') &&
          sameAccount &&
          previous.status === 'granted'
        ) {
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
  }, [apiBaseUrl, attempt, loaded, token, userId, research, replaceResearch]);

  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key === RESEARCH_SESSION_KEY || event.key === null) {
        replaceResearch(readResearchSession(), false);
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [replaceResearch]);

  useEffect(() => {
    if (!research) return;
    const recheck = () => setAttempt((value) => value + 1);
    const visible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', visible);
    // Bound the timer below the browser's maximum delay, rechecking long sessions daily.
    const timer = window.setTimeout(
      () => {
        if (Date.parse(research.expires_at) <= Date.now()) {
          replaceResearch(null);
        } else recheck();
      },
      Math.min(86400000, Math.max(0, Date.parse(research.expires_at) - Date.now())),
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [research, attempt, replaceResearch]);

  const startResearchSession = useCallback(
    async (next: ResearchSession) => {
      // End the old identity before awaiting Supabase: a deferred initial read
      // or auth callback can arrive while local sign-out is still in flight.
      replaceResearch(next);
      const generation = authGeneration.current;
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Both returned auth errors and rejected requests leave research usable.
        // replaceResearch already cleared the ordinary state.
      } finally {
        if (generation === authGeneration.current) {
          try {
            window.localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* no storage */
          }
        }
      }
    },
    [supabase, replaceResearch],
  );

  const beginOrdinarySignIn = useCallback(() => {
    if (researchRef.current) {
      const oldToken = researchRef.current.access_token;
      replaceResearch(null);
      void signOutResearch(apiBaseUrl, oldToken);
    }
    authGeneration.current += 1;
    latest.current += 1;
    ordinaryEventsEnabled.current = true;
    ordinarySessionRef.current = null;
    setSession(null);
    setAnswer(null);
    clearReadCache();
  }, [apiBaseUrl, replaceResearch]);

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
    if (researchRef.current) {
      const oldToken = researchRef.current.access_token;
      replaceResearch(null);
      await signOutResearch(apiBaseUrl, oldToken);
      return;
    }
    // Clear synchronously even when the provider throws or reports an error.
    const generation = ++authGeneration.current;
    latest.current += 1;
    ordinaryEventsEnabled.current = false;
    ordinarySessionRef.current = null;
    setSession(null);
    setAnswer(null);
    clearReadCache();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Offline sign-out still leaves this browser signed out.
    } finally {
      if (generation === authGeneration.current) {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* no storage */
        }
      }
    }
  }, [supabase, apiBaseUrl, replaceResearch]);

  const value = useMemo<FinanceSession>(
    () => ({
      status,
      canEdit: status === 'granted' && research === null,
      startResearchSession,
      beginOrdinarySignIn,
      email: research?.email ?? session?.user.email ?? null,
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
      research,
      startResearchSession,
      beginOrdinarySignIn,
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
