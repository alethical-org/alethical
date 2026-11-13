import { useCallback, useEffect, useRef, useState } from 'react';

import { useFinanceSession } from '../auth/session';
import { requestTimeoutMs } from './client';

/** What a read answered: its data, a record the server does not hold, or a
 * failure the reader can retry. A failure is never shown as an empty result. */
/** A collection's paging, as the server serves it beside `data`. */
export interface PageInfo {
  total?: number | null;
  limit?: number | null;
  offset?: number | null;
}

export type ReadAnswer<T> =
  | { state: 'ok'; data: T; page?: PageInfo | null }
  | { state: 'not-found' }
  /** `busy`: the server was still busy (503) after every suggested wait. */
  | {
      state: 'failed';
      busy?: boolean;
      changed?: boolean;
      accessDenied?: boolean;
    };

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

async function slot<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return null;
  // A canceled queued read must leave immediately, without ever taking a slot
  // or issuing a request after newer work has superseded it.
  if (running >= MAX_CONCURRENT_READS) {
    const admitted = await new Promise<boolean>((resolve) => {
      const go = () => {
        signal?.removeEventListener('abort', cancel);
        resolve(true);
      };
      const cancel = () => {
        const index = waiting.indexOf(go);
        if (index >= 0) waiting.splice(index, 1);
        signal?.removeEventListener('abort', cancel);
        resolve(false);
      };
      waiting.push(go);
      signal?.addEventListener('abort', cancel, { once: true });
    });
    if (!admitted) return null;
  } else running += 1;
  try {
    return signal?.aborted ? null : await work();
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
          ? AbortSignal.timeout(requestTimeoutMs(route))
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
    }, signal);
    if (response === null) return { state: 'failed' };
    // Only the server's own "busy" answer says when to come back; any other
    // failure is shown at once with Try again.
    const retryAfter = response.headers.get('Retry-After');
    if (response.status === 503 && retryAfter !== null && attempt < BUSY_RETRIES) {
      const seconds = Number(retryAfter);
      await pause((Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000, signal);
      continue;
    }
    if (response.status === 503 && retryAfter !== null) return { state: 'failed', busy: true };
    if (response.status === 401 || response.status === 403)
      return { state: 'failed', accessDenied: true };
    if (response.status === 409) {
      try {
        const problem = await response.json();
        if (problem?.type === 'https://api.alethical.com/problems/records-changed')
          return { state: 'failed', changed: true };
      } catch {
        /* An unreadable conflict remains an ordinary failed read. */
      }
      return { state: 'failed' };
    }
    if (response.status === 404) return { state: 'not-found' };
    if (!response.ok) return { state: 'failed' };
    try {
      const body = (await response.json()) as {
        data?: T;
        page?: PageInfo | null;
      };
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
  /** Request answered by the visible data, including a retained earlier result. */
  dataPath?: string | null;
  /** Nothing to show yet: the first load for this view. */
  loading: boolean;
  /** A result view keeps its earlier results on screen while this one loads. */
  updating: boolean;
  /** The latest request failed; a result view keeps its earlier results. */
  failed: boolean;
  /** The failure was the server staying busy through every retry. */
  busy: boolean;
  changed?: boolean;
  accessDenied?: boolean;
  notFound: boolean;
  /** A request is in flight, including a retry. */
  pending: boolean;
  /** The server's paging for the data shown, when it serves one. */
  page: PageInfo | null;
  retry: () => void;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; answer: ReadAnswer<unknown> }>();

function freshAnswer(key: string) {
  const held = cache.get(key);
  return held && Date.now() - held.at < CACHE_MS ? held.answer : null;
}

/** A retry applies only to the view it was requested on. Reset during render,
 * before a new view's read effect can start with the previous retry count. */
export function useReadRetry(key: string | null) {
  const [state, setState] = useState({ key, attempt: 0 });
  if (state.key !== key) setState({ key, attempt: 0 });
  const retry = useCallback(() => {
    if (key !== null) {
      setState((current) =>
        current.key === key ? { key, attempt: current.attempt + 1 } : current,
      );
    }
  }, [key]);
  return [state.key === key ? state.attempt : 0, retry] as const;
}

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
    acceptData,
    revision = 0,
  }: {
    keepPrevious?: boolean;
    /** A deliberate whole-list reload bypasses cached pages. */
    revision?: number | string;
    /** A few routes (`/candidates/{id}`, `/people/{id}`) answer with the record
     * itself rather than `{ data: … }`. */
    unwrapped?: boolean;
    /** A served unavailable state is a failed read, retaining earlier results. */
    acceptData?: (data: T) => boolean;
  } = {},
): Read<T> {
  const { apiBaseUrl, accessToken, retry: checkAccess } = useFinanceSession();
  const accessCheck = useRef(checkAccess);
  accessCheck.current = checkAccess;
  const accept = useRef(acceptData);
  accept.current = acceptData;
  const scope = `${apiBaseUrl}|${accessToken}`;
  const key = path ? `${scope}|${path}|${revision}` : null;
  const [answer, setAnswer] = useState<{
    key: string;
    answer: ReadAnswer<T>;
  } | null>(() => {
    const held = key ? freshAnswer(key) : null;
    return held && key ? { key, answer: held as ReadAnswer<T> } : null;
  });
  const [lastData, setLastData] = useState<{
    data: T;
    path: string;
    page: PageInfo | null;
    scope: string;
  } | null>(null);
  const [attempt, retry] = useReadRetry(key);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!key || !path) return;
    const held = attempt === 0 ? freshAnswer(key) : null;
    if (held) {
      setAnswer({ key, answer: held as ReadAnswer<T> });
      if (held.state === 'ok') {
        setLastData({
          data: held.data as T,
          path,
          page: held.page ?? null,
          scope,
        });
      }
      setPending(false);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    void apiGet<T>(apiBaseUrl, path, accessToken, fetch, controller.signal, unwrapped).then(
      (received) => {
        if (request !== latest.current) return;
        const next: ReadAnswer<T> =
          received.state === 'ok' && accept.current && !accept.current(received.data)
            ? { state: 'failed' }
            : received;
        setPending(false);
        if (next.state === 'failed' && next.accessDenied) {
          clearReadCache();
          setLastData(null);
          accessCheck.current?.();
        }
        if (next.state !== 'failed') cache.set(key, { at: Date.now(), answer: next });
        setAnswer({ key, answer: next });
        if (next.state === 'ok')
          setLastData({ data: next.data, path, page: next.page ?? null, scope });
      },
    );
    return () => {
      // A superseded or abandoned read must never write its answer, including
      // the failure its own abort produces.
      latest.current += 1;
      controller.abort();
    };
  }, [apiBaseUrl, accessToken, key, path, attempt, unwrapped, scope]);

  const current = answer && answer.key === key ? answer.answer : null;
  const own =
    current?.state === 'ok' ? { data: current.data, path, page: current.page ?? null } : null;
  const prior = lastData?.scope === scope ? lastData : null;
  const denied = current?.state === 'failed' && current.accessDenied;
  const shown = key === null || denied ? null : (own ?? (keepPrevious ? prior : null));
  return {
    data: shown?.data ?? null,
    dataPath: shown?.path ?? null,
    page: shown?.page ?? null,
    loading: key !== null && shown === null && (current === null || pending),
    updating:
      key !== null &&
      keepPrevious &&
      own === null &&
      prior !== null &&
      (current === null || pending),
    failed: current?.state === 'failed' && !pending,
    busy: current?.state === 'failed' && current.busy === true && !pending,
    changed: current?.state === 'failed' && current.changed === true,
    accessDenied: current?.state === 'failed' && current.accessDenied === true,
    notFound: current?.state === 'not-found',
    pending: key !== null && pending,
    retry,
  };
}
