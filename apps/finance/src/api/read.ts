import { useCallback, useEffect, useRef, useState } from 'react';

import { useFinanceSession } from '../auth/session';
import { REQUEST_TIMEOUT_MS } from './client';

/** What a read answered: its data, a record the server does not hold, or a
 * failure the reader can retry. A failure is never shown as an empty result. */
/** A collection's paging, as the server serves it beside `data`. */
export interface PageInfo {
  total?: number | null;
  limit?: number | null;
  offset?: number | null;
}

export type ReadAnswer<T> =
  { state: 'ok'; data: T; page?: PageInfo | null } | { state: 'not-found' } | { state: 'failed' };

type Fetch = typeof fetch;

/**
 * An API read path from its parts, each encoded, with the query values given:
 * `apiPath(['committees', id, 'payments'], { year })` is
 * `committees/12/payments?year=2026`. Written as parts, no path text ships in the
 * build that the link check (scripts/check-built-links.mjs) could mistake for a
 * page on the public site.
 */
export function apiPath(
  parts: ReadonlyArray<string | number>,
  query: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const path = parts.map((part) => encodeURIComponent(String(part))).join('/');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const rest = search.toString();
  return rest ? `${path}?${rest}` : path;
}

/**
 * The shared API lets only 12 requests run at once for every reader of both
 * sites (alethical/api/request_admission.py), and answers the rest "busy"
 * (503). Finance runs at most 4 of its reads at a time and queues the rest, so
 * 1 page never crowds out other readers or its own later reads.
 */
export const MAX_CONCURRENT_READS = 4;
/** A "busy" answer is retried after the server's suggested wait, this many times. */
export const BUSY_RETRIES = 2;

let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  // A finished read hands its slot straight to the next waiting one, so a new
  // read can never slip in between and make 5.
  if (running >= MAX_CONCURRENT_READS) await new Promise<void>((go) => waiting.push(go));
  else running += 1;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      done();
    });
  });
}

/** 1 GET to the shared Alethical API, with this account's token on Finance's
 * own routes. `path` is the API route after `/api/v1/`, written without its
 * leading slash (`people/12`), so a read path is never mistaken for a page link
 * by the build's link check. Every answer that carries a token is private, so
 * nothing here is shared between accounts. */
export async function apiGet<T>(
  apiBaseUrl: string,
  path: string,
  accessToken: string | null,
  fetcher: Fetch = fetch,
  signal?: AbortSignal,
  unwrapped = false,
): Promise<ReadAnswer<T>> {
  const route = path.replace(/^\/+/, '');
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) return { state: 'failed' };
    const response = await slot(async () => {
      const timeout =
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : undefined;
      const signals = [signal, timeout].filter(Boolean) as AbortSignal[];
      try {
        return await fetcher(`${apiBaseUrl}/api/v1/${route}`, {
          // Only Finance's own routes need the account; a public read carries no
          // token, so it stays cacheable and never depends on sign-in.
          headers:
            accessToken && route.startsWith('finance/')
              ? { Authorization: `Bearer ${accessToken}` }
              : {},
          signal:
            signals.length > 1 && typeof AbortSignal.any === 'function'
              ? AbortSignal.any(signals)
              : signals[0],
        });
      } catch {
        return null;
      }
    });
    if (response === null) return { state: 'failed' };
    // Only the server's own "busy" answer says when to come back; any other
    // failure is shown at once with Try again.
    const retryAfter = response.headers.get('Retry-After');
    if (response.status === 503 && retryAfter !== null && attempt < BUSY_RETRIES) {
      const seconds = Number(retryAfter);
      await pause((Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000, signal);
      continue;
    }
    if (response.status === 404) return { state: 'not-found' };
    if (!response.ok) return { state: 'failed' };
    try {
      const body = (await response.json()) as { data?: T; page?: PageInfo | null };
      if (body === null || typeof body !== 'object') return { state: 'failed' };
      if (unwrapped) return { state: 'ok', data: body as T };
      if (!('data' in body)) return { state: 'failed' };
      return { state: 'ok', data: body.data as T, page: body.page ?? null };
    } catch {
      return { state: 'failed' };
    }
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
  /** The server's paging for the data shown, when it serves one. */
  page: PageInfo | null;
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
export function useRead<T>(
  path: string | null,
  {
    keepPrevious = false,
    unwrapped = false,
  }: {
    keepPrevious?: boolean;
    /** A few routes (`/candidates/{id}`, `/people/{id}`) answer with the record
     * itself rather than `{ data: … }`. */
    unwrapped?: boolean;
  } = {},
): Read<T> {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const key = path ? `${accessToken}|${path}` : null;
  const [answer, setAnswer] = useState<{ key: string; answer: ReadAnswer<T> } | null>(() => {
    const held = key ? cache.get(key) : undefined;
    return held && key ? { key, answer: held.answer as ReadAnswer<T> } : null;
  });
  const [lastData, setLastData] = useState<{ data: T; page: PageInfo | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!key || !path) return;
    const held = cache.get(key);
    if (held && Date.now() - held.at < CACHE_MS && attempt === 0) {
      setAnswer({ key, answer: held.answer as ReadAnswer<T> });
      if (held.answer.state === 'ok') {
        setLastData({ data: held.answer.data as T, page: held.answer.page ?? null });
      }
      setPending(false);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    void apiGet<T>(apiBaseUrl, path, accessToken, fetch, controller.signal, unwrapped).then(
      (next) => {
        if (request !== latest.current) return;
        setPending(false);
        if (next.state !== 'failed') cache.set(key, { at: Date.now(), answer: next });
        setAnswer({ key, answer: next });
        if (next.state === 'ok') setLastData({ data: next.data, page: next.page ?? null });
      },
    );
    return () => {
      // A superseded or abandoned read must never write its answer, including
      // the failure its own abort produces.
      latest.current += 1;
      controller.abort();
    };
  }, [apiBaseUrl, accessToken, key, path, attempt, unwrapped]);

  // A new address starts over: a retry count belongs to the view it was made on.
  useEffect(() => setAttempt(0), [key]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = answer && answer.key === key ? answer.answer : null;
  const own = current?.state === 'ok' ? { data: current.data, page: current.page ?? null } : null;
  const shown = own ?? (keepPrevious ? lastData : null);
  return {
    data: shown?.data ?? null,
    page: shown?.page ?? null,
    loading: shown === null && (current === null || pending),
    updating: keepPrevious && own === null && lastData !== null && (current === null || pending),
    failed: current?.state === 'failed' && !pending,
    notFound: current?.state === 'not-found',
    pending,
    retry,
  };
}
