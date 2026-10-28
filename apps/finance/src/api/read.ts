import { useCallback, useEffect, useRef, useState } from 'react';

import { useFinanceSession } from '../auth/session';
import { REQUEST_TIMEOUT_MS } from './client';

/** What a read answered: its data, a record the server does not hold, or a
 * failure the reader can retry. A failure is never shown as an empty result. */
export type ReadAnswer<T> = { state: 'ok'; data: T } | { state: 'not-found' } | { state: 'failed' };

type Fetch = typeof fetch;

/** 1 GET to the shared Alethical API with this account's token. Every answer that
 * carries a token is private, so nothing here is shared between accounts. */
export async function apiGet<T>(
  apiBaseUrl: string,
  path: string,
  accessToken: string | null,
  fetcher: Fetch = fetch,
  signal?: AbortSignal,
): Promise<ReadAnswer<T>> {
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  const signals = [signal, timeout].filter(Boolean) as AbortSignal[];
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      signal:
        signals.length > 1 && typeof AbortSignal.any === 'function'
          ? AbortSignal.any(signals)
          : signals[0],
    });
    if (response.status === 404) return { state: 'not-found' };
    if (!response.ok) return { state: 'failed' };
    const body = (await response.json()) as { data?: T };
    if (body === null || typeof body !== 'object' || !('data' in body)) return { state: 'failed' };
    return { state: 'ok', data: body.data as T };
  } catch {
    return { state: 'failed' };
  }
}

export interface Read<T> {
  /** This view's data; for a result view, the previous view's while the next
   * loads (see `updating`). */
  data: T | null;
  /** Nothing to show yet: the first load for this view. */
  loading: boolean;
  /** A result view keeps its earlier results on screen while this one loads. */
  updating: boolean;
  /** The latest request failed; a result view keeps its earlier results. */
  failed: boolean;
  notFound: boolean;
  /** A request is in flight, including a retry. */
  pending: boolean;
  retry: () => void;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; answer: ReadAnswer<unknown> }>();

/** Forget every held answer: on sign-out or an account change, nothing read for
 * 1 account may be shown to the next. */
export function clearReadCache() {
  cache.clear();
}

/**
 * Reads `path` for the signed-in account. An older answer never replaces a
 * newer request's, and a recent answer is reused for a minute so Back shows it
 * at once. A record page never shows another record while its own loads; a
 * result view (`keepPrevious`) keeps its last results visible instead.
 */
export function useRead<T>(path: string | null, { keepPrevious = false } = {}): Read<T> {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const key = path ? `${accessToken}|${path}` : null;
  const [answer, setAnswer] = useState<{ key: string; answer: ReadAnswer<T> } | null>(() => {
    const held = key ? cache.get(key) : undefined;
    return held && key ? { key, answer: held.answer as ReadAnswer<T> } : null;
  });
  const [lastData, setLastData] = useState<T | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!key || !path) return;
    const held = cache.get(key);
    if (held && Date.now() - held.at < CACHE_MS && attempt === 0) {
      setAnswer({ key, answer: held.answer as ReadAnswer<T> });
      if (held.answer.state === 'ok') setLastData(held.answer.data as T);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    void apiGet<T>(apiBaseUrl, path, accessToken, fetch, controller.signal).then((next) => {
      if (request !== latest.current) return;
      setPending(false);
      if (next.state !== 'failed') cache.set(key, { at: Date.now(), answer: next });
      setAnswer({ key, answer: next });
      if (next.state === 'ok') setLastData(next.data);
    });
    return () => controller.abort();
  }, [apiBaseUrl, accessToken, key, path, attempt]);

  // A new address starts over: a retry count belongs to the view it was made on.
  useEffect(() => setAttempt(0), [key]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = answer && answer.key === key ? answer.answer : null;
  const own = current?.state === 'ok' ? current.data : null;
  const shown = own ?? (keepPrevious ? lastData : null);
  return {
    data: shown,
    loading: shown === null && (current === null || pending),
    updating: keepPrevious && own === null && lastData !== null && (current === null || pending),
    failed: current?.state === 'failed' && !pending,
    notFound: current?.state === 'not-found',
    pending,
    retry,
  };
}
