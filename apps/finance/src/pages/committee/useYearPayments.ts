import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import type { AttachedStatementRow, BlockState, PaymentPage } from './types';

/** The server's largest page (MAX_PAYMENTS in campaign_finance_payments.py). */
const PAGE = 250;
const AT_ONCE = 4;
const CACHE_MS = 60_000;

/** Every payment one committee filed for one year in one direction: the grouped
 * rows, the tab counts and the name totals all need the whole year, never a page. */
export interface YearPayments<T> {
  state: BlockState;
  payments: T[];
  linkable: ReadonlySet<string>;
  statements: AttachedStatementRow[];
  /** The catalogue copy dates the pages named, without repeats. */
  statementsCopiedOn: string[];
  fetchedAt: string | null;
}

export interface YearPaymentsRead<T> {
  data: YearPayments<T> | null;
  loading: boolean;
  /** The latest attempt failed. `data` then holds this same view's last complete
   * list, if one was ever loaded, never another year's or another direction's. */
  failed: boolean;
  pending: boolean;
  retry: () => void;
}

const cache = new Map<string, { at: number; value: YearPayments<unknown> }>();

/** Forget every list: used by tests; sign-out clears the token the key carries. */
export function clearYearPayments() {
  cache.clear();
}

async function loadAll<T>(
  apiBaseUrl: string,
  base: string,
  token: string | null,
  signal: AbortSignal,
): Promise<YearPayments<T> | null> {
  const get = (offset: number) =>
    apiGet<PaymentPage<T>>(
      apiBaseUrl,
      `${base}&limit=${PAGE}&offset=${offset}`,
      token,
      fetch,
      signal,
    );
  const first = await get(0);
  if (first.state !== 'ok') return null;
  const head = first.data;
  const pages = [head];
  if (head.state === 'reported' && head.page.has_more) {
    const total = head.page.total_payments;
    if (total === null) return null;
    const offsets: number[] = [];
    for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset);
    for (let start = 0; start < offsets.length; start += AT_ONCE) {
      const answers = await Promise.all(offsets.slice(start, start + AT_ONCE).map(get));
      for (const answer of answers) {
        // A page from another release would mix 2 copies of the file.
        if (answer.state !== 'ok' || answer.data.release_id !== head.release_id) return null;
        pages.push(answer.data);
      }
    }
    const count = pages.reduce((sum, page) => sum + page.payments.length, 0);
    if (count !== total) return null;
  }
  return {
    state: head.state,
    payments: head.state === 'reported' ? pages.flatMap((page) => page.payments) : [],
    linkable: new Set(pages.flatMap((page) => page.linkable_registration_numbers ?? [])),
    statements: pages.flatMap((page) => page.disclosure_statements ?? []),
    statementsCopiedOn: [
      ...new Set(
        pages.map((page) => page.statements_copied_on).filter((day): day is string => Boolean(day)),
      ),
    ],
    fetchedAt: head.fetched_at,
  };
}

/** `path` is the payments address without paging, or null to read nothing. */
export function useYearPayments<T>(path: string | null): YearPaymentsRead<T> {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const key = path ? `${accessToken}|${path}` : null;
  const [answer, setAnswer] = useState<{
    key: string;
    value: YearPayments<T> | null;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!key || !path) return;
    const held = cache.get(key);
    if (held && Date.now() - held.at < CACHE_MS && attempt === 0) {
      setAnswer({ key, value: held.value as YearPayments<T>, failed: false });
      setPending(false);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    void loadAll<T>(apiBaseUrl, path, accessToken, controller.signal).then((value) => {
      if (request !== latest.current) return;
      setPending(false);
      if (value) {
        cache.set(key, { at: Date.now(), value });
        setAnswer({ key, value, failed: false });
      } else {
        const earlier = cache.get(key);
        setAnswer({ key, value: (earlier?.value as YearPayments<T>) ?? null, failed: true });
      }
    });
    return () => {
      // A superseded or abandoned read must never write its answer, including
      // the failure its own abort produces.
      latest.current += 1;
      controller.abort();
    };
  }, [apiBaseUrl, accessToken, key, path, attempt]);

  useEffect(() => setAttempt(0), [key]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = answer && answer.key === key ? answer : null;
  return {
    data: current?.value ?? null,
    loading: key !== null && current === null,
    failed: current?.failed === true && !pending,
    pending,
    retry,
  };
}
