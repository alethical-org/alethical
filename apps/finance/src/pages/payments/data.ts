import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPath, useRead } from '../../api/read';
import { useFinanceSession } from '../../auth/session';

/**
 * Reads for the 2 printed-name pages (Payments under this name, Donors by employer):
 * `/campaign-finance/payments-under-name` (alethical/api/routers/public.py) and the
 * identity records listing (`/finance/identities/records`,
 * alethical/api/routers/finance_identities.py). Only the fields the pages print are
 * typed; every value may be missing and is read as such.
 */

/** The server's own role values, verbatim. */
export type ServerRole = 'contributor' | 'vendor' | 'independent_vendor' | 'employer';

/** The server's largest page of payments (MAX_PAYMENTS in campaign_finance_payments.py). */
export const NAME_PAGE = 250;

export type NameState = 'reported' | 'not_reported' | 'unavailable';

/** A received-payments row (role `contributor` or `employer`). */
export interface ReceivedRow {
  recipient_registration_number: string | null;
  recipient_name: string | null;
  contributor: string | null;
  contributor_type: string | null;
  employer: string | null;
  amount: string | null;
  received_on: string | null;
  year: number | null;
  receipt_type: string | null;
  record_number: number;
}

/** An expenditures row (role `vendor`). */
export interface SpentRow {
  committee_registration_number: string | null;
  committee_name: string | null;
  vendor_name: string | null;
  amount: string | null;
  paid_on: string | null;
  year: number | null;
  expenditure_type: string | null;
  purpose: string | null;
  record_number: number;
}

/** An independent-expenditures row (role `independent_vendor`). */
export interface OutsideRow {
  spender: string | null;
  spender_registration_number: string | null;
  affected_committee_name: string | null;
  stance: string | null;
  vendor_name: string | null;
  amount: string | null;
  paid_on: string | null;
  year: number | null;
  expenditure_type: string | null;
  purpose: string | null;
  record_number: number;
}

export interface NamePage<T> {
  name: string;
  role: ServerRole;
  year: number | null;
  state: NameState;
  payments: T[];
  page: { limit: number; offset: number; has_more: boolean; total_payments: number | null };
  linkable_registration_numbers: string[];
  source_url: string | null;
  release_id: string;
  fetched_at: string | null;
}

/** Every page of payments read so far for 1 name, role and year. */
export interface NamePayments<T> {
  /** The name, role and year these payments answer, so earlier results shown while
   * a new view loads are always read as what they are. */
  name: string;
  role: ServerRole;
  year: number | null;
  state: NameState;
  payments: T[];
  /** More rows are filed than are loaded; the server serves no count of them. */
  hasMore: boolean;
  linkable: ReadonlySet<string>;
  sourceUrl: string | null;
  fetchedAt: string | null;
  releaseId: string;
}

export interface NamePaymentsRead<T> {
  /** This view's payments; while a new view loads, the previous view's. */
  data: NamePayments<T> | null;
  /** Nothing to show yet. */
  loading: boolean;
  /** Earlier results are shown while this view loads. */
  updating: boolean;
  /** The latest first-page read failed. */
  failed: boolean;
  pending: boolean;
  /** Reading the next page. */
  loadingMore: boolean;
  /** The next page failed; the payments already loaded stay. */
  moreFailed: boolean;
  retry: () => void;
  more: () => void;
}

/** The path for 1 name's payments, without paging. */
export function namePaymentsQuery(
  name: string,
  role: ServerRole,
  year: number | null,
): Record<string, string | number | null> {
  return { name, role, year };
}

function pagePath(query: Record<string, string | number | null>, offset: number): string {
  return apiPath(['campaign-finance', 'payments-under-name'], {
    ...query,
    limit: NAME_PAGE,
    offset,
  });
}

function fromPage<T>(page: NamePage<T>): NamePayments<T> {
  return {
    name: page.name,
    role: page.role,
    year: page.year ?? null,
    state: page.state,
    payments: page.state === 'reported' ? page.payments : [],
    hasMore: page.state === 'reported' && page.page.has_more,
    linkable: new Set(page.linkable_registration_numbers ?? []),
    sourceUrl: page.source_url ?? null,
    fetchedAt: page.fetched_at ?? null,
    releaseId: page.release_id,
  };
}

/**
 * 1 name's payments, a page of 250 at a time. The server serves no count on a
 * name-keyed lookup, so a page never says how many remain; `more` reads the next
 * page and adds it, refusing a page from another release (2 copies of the file
 * must never mix). A new name, role or year keeps the earlier results visible
 * while it loads. An abandoned read never writes its answer.
 */
export function useNamePayments<T>(
  query: Record<string, string | number | null> | null,
): NamePaymentsRead<T> {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const first = query ? pagePath(query, 0) : null;
  const key = first ? `${accessToken}|${first}` : null;
  const [answer, setAnswer] = useState<{
    key: string;
    value: NamePayments<T> | null;
    failed: boolean;
  } | null>(null);
  const [last, setLast] = useState<NamePayments<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const latest = useRef(0);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!key || !first) return;
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    setLoadingMore(false);
    setMoreFailed(false);
    void apiGet<NamePage<T>>(apiBaseUrl, first, accessToken, fetch, controller.signal).then(
      (next) => {
        if (request !== latest.current) return;
        setPending(false);
        if (next.state === 'ok') {
          const value = fromPage(next.data);
          setAnswer({ key, value, failed: false });
          setLast(value);
        } else {
          setAnswer({ key, value: null, failed: true });
        }
      },
    );
    return () => {
      // A superseded or abandoned read must never write its answer, including the
      // failure its own abort produces.
      latest.current += 1;
      controller.abort();
      moreController.current?.abort();
    };
  }, [apiBaseUrl, accessToken, key, first, attempt]);

  useEffect(() => setAttempt(0), [key]);

  const current = answer && answer.key === key ? answer : null;
  const own = current?.value ?? null;

  const more = useCallback(() => {
    if (!query || !key || !own || !own.hasMore || loadingMore) return;
    const request = latest.current;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreFailed(false);
    void apiGet<NamePage<T>>(
      apiBaseUrl,
      pagePath(query, own.payments.length),
      accessToken,
      fetch,
      controller.signal,
    ).then((next) => {
      if (request !== latest.current) return;
      setLoadingMore(false);
      if (
        next.state !== 'ok' ||
        next.data.release_id !== own.releaseId ||
        next.data.state !== 'reported'
      ) {
        setMoreFailed(true);
        return;
      }
      const value: NamePayments<T> = {
        ...own,
        payments: [...own.payments, ...next.data.payments],
        hasMore: next.data.page.has_more,
        linkable: new Set([...own.linkable, ...(next.data.linkable_registration_numbers ?? [])]),
      };
      setAnswer({ key, value, failed: false });
      setLast(value);
    });
    // `query` is rebuilt each render; `key` carries its meaning.
  }, [apiBaseUrl, accessToken, key, own, loadingMore]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // A failed view never shows another view's results.
  const failed = current?.failed === true && !pending;
  const shown = key === null ? null : (own ?? (failed ? null : last));
  return {
    data: shown,
    loading: key !== null && shown === null && !failed,
    updating: own === null && shown !== null,
    failed,
    pending,
    loadingMore,
    moreFailed,
    retry,
    more,
  };
}

// --- Identity confirmations ---------------------------------------------------------

/** The printed-name record kinds the identity routes take. */
export type PrintedKind = 'donor_name' | 'employer_name' | 'payee_name' | 'independent_payee_name';

export interface IdentitySummary {
  id: string;
  kind: 'person' | 'organization' | string;
  name: string;
  /** How many of the name's current records this identity's confirmations cover. */
  confirmed: number;
}

/** `GET /finance/identities/records`: the records in the Board's current file
 * printing a name, and the identities that confirm some of them. */
export interface IdentityRecords {
  record_kind: string;
  record_key: string;
  /** Records in the Board's current file printing this exact name. */
  records: number;
  confirmed: number;
  identities: IdentitySummary[];
}

/** The identities that confirm records printing exactly this name, for 1 kind. */
export function useIdentityRecords(kind: PrintedKind, name: string | null) {
  return useRead<IdentityRecords>(
    name
      ? apiPath(['finance', 'identities', 'records'], { record_kind: kind, record_key: name })
      : null,
  );
}

/** "Confirmed for {k} of {n} records" (Confirm Identities wording, build notes
 * Round 20), only when the identity covers some of the name's records but not all.
 * A confirmation covers the records chosen, never the spelling as a whole. */
export function partialLine(identity: IdentitySummary, records: number): string | null {
  return identity.confirmed < records
    ? `Confirmed for ${identity.confirmed.toLocaleString('en-US')} of ${records.toLocaleString('en-US')} records`
    : null;
}
