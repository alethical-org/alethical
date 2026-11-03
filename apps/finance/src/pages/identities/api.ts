import { useCallback, useEffect, useRef, useState } from 'react';

import { REQUEST_TIMEOUT_MS } from '../../api/client';
import { apiPath } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import type { PrintedKind, RecordsPage } from './types';

/** The server's refusal when a pinned page or selection names an older source copy
 * (identity_confirmations._same_snapshot). The page shows it as the reload notice. */
export const SOURCE_CHANGED = 'The Board’s file changed. Reload the records and select again.';

function problemDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const inner = (detail as { detail?: unknown }).detail;
    return typeof inner === 'string' ? inner : '';
  }
  return '';
}

function sourceChanged(detail: string): boolean {
  return detail.replace(/[’']/g, "'") === SOURCE_CHANGED.replace(/[’']/g, "'");
}

export type WriteResult<T> =
  | { ok: true; data: T }
  /** The server refused the change as asked (422) and said why. */
  | { ok: false; reason: 'refused'; message: string }
  /** The source copy named by the request is no longer the current one. */
  | { ok: false; reason: 'source-changed' }
  /** Another change claimed a selected record first (409). */
  | { ok: false; reason: 'conflict'; message: string }
  /** The server would not take this request (another refusal, such as a removed
   * identity); nothing was changed. */
  | { ok: false; reason: 'rejected' }
  /** The change may or may not have been saved; nothing is marked saved. */
  | { ok: false; reason: 'failed' };

/** 1 POST to a Finance route. Every failure keeps the reader's entries; only a
 * 2xx answer counts as saved. */
export async function write<T>(
  apiBaseUrl: string,
  accessToken: string | null,
  path: string,
  body: unknown,
  fetcher: typeof fetch = fetch,
): Promise<WriteResult<T>> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl}/api/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal:
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : undefined,
    });
  } catch {
    return { ok: false, reason: 'failed' };
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (response.ok) {
    const data = parsed && typeof parsed === 'object' ? (parsed as { data?: T }).data : undefined;
    return data === undefined ? { ok: false, reason: 'failed' } : { ok: true, data };
  }
  const detail = problemDetail(parsed);
  if (response.status === 422 && sourceChanged(detail))
    return { ok: false, reason: 'source-changed' };
  if (response.status === 422 && detail) return { ok: false, reason: 'refused', message: detail };
  if (response.status === 409) return { ok: false, reason: 'conflict', message: detail };
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  )
    return { ok: false, reason: 'rejected' };
  return { ok: false, reason: 'failed' };
}

export interface RecordsQuery {
  kind: PrintedKind;
  key: string;
  page: number;
  pageSize: number;
  year?: number | null;
  /** The source copy the listing stays on across pages; null reads the current one. */
  snapshotId: string | null;
}

export interface RecordsRead {
  data: RecordsPage | null;
  loading: boolean;
  updating: boolean;
  failed: boolean;
  /** The pinned source copy is no longer current: the page offers Reload the records. */
  stale: boolean;
  pending: boolean;
  retry: () => void;
}

export function recordsPath(query: RecordsQuery): string {
  return apiPath(['finance', 'identities', 'records'], {
    record_kind: query.kind,
    record_key: query.key,
    page: query.page,
    page_size: query.pageSize,
    year: query.year ?? null,
    snapshot_id: query.snapshotId,
  });
}

/**
 * A printed name's records, 1 pinned page at a time. The shared reader
 * (`useRead`) folds every refusal into "failed"; this one tells a changed source
 * copy apart (409, or the server's own sentence), because the form must then ask
 * for a reload rather than a retry. Earlier results stay while the next page loads.
 */
export function useRecords(query: RecordsQuery | null, version = 0): RecordsRead {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const path = query ? recordsPath(query) : null;
  const key = path ? `${apiBaseUrl}|${accessToken}|${path}` : null;
  const [answer, setAnswer] = useState<{
    key: string;
    state: 'ok' | 'failed' | 'stale';
    data?: RecordsPage;
  } | null>(null);
  const [last, setLast] = useState<{ data: RecordsPage; scope: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);
  const scope = `${apiBaseUrl}|${accessToken}`;

  useEffect(() => {
    if (!key || !path) return;
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    (async () => {
      let next: { state: 'ok' | 'failed' | 'stale'; data?: RecordsPage } = { state: 'failed' };
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/${path}`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
          signal: controller.signal,
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: RecordsPage };
          if (body?.data) next = { state: 'ok', data: body.data };
        } else if (response.status === 409) {
          next = { state: 'stale' };
        } else if (response.status === 422) {
          let body: unknown = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          if (sourceChanged(problemDetail(body))) next = { state: 'stale' };
        }
      } catch {
        next = { state: 'failed' };
      }
      if (request !== latest.current) return;
      setPending(false);
      setAnswer({ key, ...next });
      if (next.state === 'ok' && next.data) setLast({ data: next.data, scope });
    })();
    return () => {
      latest.current += 1;
      controller.abort();
    };
  }, [apiBaseUrl, accessToken, key, path, attempt, version, scope]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = answer && answer.key === key ? answer : null;
  const own = current?.state === 'ok' && current.data ? current.data : null;
  const prior = last?.scope === scope ? last.data : null;
  const shown = key === null ? null : (own ?? prior);
  return {
    data: shown,
    loading: key !== null && shown === null && (current === null || pending),
    updating: key !== null && own === null && prior !== null && (current === null || pending),
    failed: current?.state === 'failed' && !pending,
    stale: current?.state === 'stale' && !pending,
    pending,
    retry,
  };
}
