import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, type ReadAnswer } from '../../api/read';
import { useFinanceSession } from '../../auth/session';

/** 1 read inside a loader: the shared queue, retry-on-busy and token rules apply. */
export type Get = <T>(path: string) => Promise<ReadAnswer<T>>;

/** A loader answers its value, or null when any read it needed failed. */
export type Loader<T> = (get: Get) => Promise<T | null>;

export interface Load<T> {
  data: T | null;
  loading: boolean;
  /** The latest attempt failed; `data` then holds this same view's last answer, if any. */
  failed: boolean;
  pending: boolean;
  retry: () => void;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

/** Forget every held answer: used by tests; sign-out changes the token the key carries. */
export function clearOrganizationLoads() {
  cache.clear();
}

/**
 * A section that needs several reads to answer (the pattern of
 * committee/useYearPayments.ts): `key` names what is loaded, null for nothing.
 * An abandoned or superseded load never writes its answer.
 */
export function useLoad<T>(key: string | null, loader: Loader<T>): Load<T> {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const full = key ? `${accessToken}|${key}` : null;
  const load = useRef(loader);
  load.current = loader;
  const [answer, setAnswer] = useState<{ key: string; value: T | null; failed: boolean } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!full) return;
    const held = cache.get(full);
    if (held && Date.now() - held.at < CACHE_MS && attempt === 0) {
      setAnswer({ key: full, value: held.value as T, failed: false });
      setPending(false);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    const get: Get = (path) => apiGet(apiBaseUrl, path, accessToken, fetch, controller.signal);
    setPending(true);
    void load
      .current(get)
      .catch(() => null)
      .then((value) => {
        if (request !== latest.current) return;
        setPending(false);
        if (value !== null) {
          cache.set(full, { at: Date.now(), value });
          setAnswer({ key: full, value, failed: false });
        } else {
          const earlier = cache.get(full);
          setAnswer({ key: full, value: (earlier?.value as T) ?? null, failed: true });
        }
      });
    return () => {
      // A superseded or abandoned load must never write its answer, including
      // the failure its own abort produces.
      latest.current += 1;
      controller.abort();
    };
  }, [apiBaseUrl, accessToken, full, attempt]);

  useEffect(() => setAttempt(0), [full]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = answer && answer.key === full ? answer : null;
  return {
    data: current?.value ?? null,
    loading: full !== null && current === null,
    failed: current?.failed === true && !pending,
    pending,
    retry,
  };
}
