import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPath, useRead } from '../../api/read';
import { useFinanceSession } from '../../auth/session';

/**
 * Reads for the 2 printed-name pages (Payments under this name, Donors by employer):
 * Finance's `/finance/payments-under-name` (alethical/api/routers/finance.py,
 * services/finance_payments_under_name.py: the shared money site's own rows, states and
 * paging, plus each row's fingerprint, confirmed identity, evidence locator and
 * excerpt) and the identity records listing (`/finance/identities/records`,
 * alethical/api/routers/finance_identities.py). Only the fields the pages print
 * are typed; every value may be missing and is read as such.
 */

/** The server's own role values, verbatim. */
export type ServerRole = 'contributor' | 'vendor' | 'independent_vendor' | 'employer';

/** The Finance route's largest page of payments (its `limit` maximum). */
export const NAME_PAGE = 200;

export type NameState = 'reported' | 'not_reported' | 'unavailable';

/** The identity a row's own fingerprint is confirmed to, as it stands today. */
export interface RowIdentity {
  id: string;
  kind: string;
  name: string;
  reference?: string | null;
}

/** Where a row is held: the file, the saved copy and the record number in it. */
export interface RowEvidence {
  dataset: string | null;
  snapshot_id: string | null;
  record_number: number | null;
  source_url: string | null;
  copied_at: string | null;
}

/** What every Finance row adds: its server fingerprint, its identity or null, its
 * evidence locator and its excerpt (the whole source row, in the file's order). */
export interface RowFacts {
  fingerprint?: string | null;
  identity?: RowIdentity | null;
  evidence?: RowEvidence | null;
  /** Every column of the source row as the file lays it out: [the file's column
   * label, the held value as text]. A blank cell is null; amounts, dates
   * (YYYY-MM-DD) and years are the values the loader parsed. */
  excerpt?: Array<[string, string | null]> | null;
}

/** A received-payments row (role `contributor` or `employer`). */
export interface ReceivedRow extends RowFacts {
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
  /** The ZIP exactly as filed; never padded or repaired. */
  contributor_zip?: string | null;
}

/** An expenditures row (role `vendor`). */
export interface SpentRow extends RowFacts {
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
export interface OutsideRow extends RowFacts {
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

/** Each identity holding records of the spelling in the read's scope (year and
 * filer), with how many. */
export interface ScopeIdentity {
  id: string;
  kind: string;
  name: string;
  reference?: string | null;
  confirmed_records: number;
}

export interface NamePage<T> {
  name: string;
  role: ServerRole;
  year: number | null;
  filer?: string | null;
  state: NameState;
  payments: T[];
  page: { limit: number; offset: number; has_more: boolean; total_payments: number | null };
  linkable_registration_numbers: string[];
  source_url: string | null;
  release_id: string;
  fetched_at: string | null;
  identities?: ScopeIdentity[];
}

/** Every page of payments read so far for 1 name, role, year and filer. */
export interface NamePayments<T> {
  /** The name, role, year and filer these payments answer, so earlier results shown
   * while a new view loads are always read as what they are. */
  name: string;
  role: ServerRole;
  year: number | null;
  filer: string | null;
  state: NameState;
  payments: T[];
  hasMore: boolean;
  /** Every row the read's scope matches, counted by the server; null when not served. */
  total: number | null;
  /** The identities holding records in this scope, with their counts. */
  identities: ScopeIdentity[];
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
  /** The Board's file changed since the first page: the pages cannot be joined. */
  changed: boolean;
  /** Read the first page again, starting over. */
  retry: () => void;
  more: () => void;
}

/** The query for 1 name's payments, without paging. */
export function namePaymentsQuery(
  name: string,
  role: ServerRole,
  year: number | null,
  filer: string | null = null,
): Record<string, string | number | null> {
  return { name, role, year, filer };
}

function pagePath(
  query: Record<string, string | number | null>,
  offset: number,
  releaseId: string | null = null,
): string {
  return apiPath(['finance', 'payments-under-name'], {
    ...query,
    limit: NAME_PAGE,
    offset: offset || null,
    release_id: releaseId,
  });
}

function fromPage<T>(page: NamePage<T>): NamePayments<T> {
  return {
    name: page.name,
    role: page.role,
    year: page.year ?? null,
    filer: page.filer ?? null,
    state: page.state,
    payments: page.state === 'reported' ? page.payments : [],
    hasMore: page.state === 'reported' && page.page.has_more,
    total: page.state === 'reported' ? (page.page.total_payments ?? null) : null,
    identities: page.identities ?? [],
    linkable: new Set(page.linkable_registration_numbers ?? []),
    sourceUrl: page.source_url ?? null,
    fetchedAt: page.fetched_at ?? null,
    releaseId: page.release_id,
  };
}

/**
 * 1 name's payments, a page of 200 at a time. Later pages are pinned to the first
 * page's `release_id`: a changed Board file answers 409, and the page then says so
 * and offers to start over, because 2 copies of the file must never mix. A new
 * name, role, year or filer keeps the earlier results visible while it loads. An
 * abandoned read never writes its answer.
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
  const [changed, setChanged] = useState(false);
  const latest = useRef(0);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!key || !first) return;
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    setLoadingMore(false);
    setMoreFailed(false);
    setChanged(false);
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
    if (!query || !key || !own || !own.hasMore || loadingMore || changed) return;
    const request = latest.current;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreFailed(false);
    let status = 0;
    const seen: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      status = response.status;
      return response;
    };
    void apiGet<NamePage<T>>(
      apiBaseUrl,
      pagePath(query, own.payments.length, own.releaseId),
      accessToken,
      seen,
      controller.signal,
    ).then((next) => {
      if (request !== latest.current) return;
      setLoadingMore(false);
      if (status === 409) {
        setChanged(true);
        return;
      }
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
  }, [apiBaseUrl, accessToken, key, own, loadingMore, changed]);

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
    changed,
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

/** The identities that confirm records printing exactly this name, for 1 kind,
 * counted over 1 year's records when a year is given. Only the counts are read, so
 * 1 fingerprint is asked for. */
export function useIdentityRecords(
  kind: PrintedKind,
  name: string | null,
  year: number | null = null,
) {
  return useRead<IdentityRecords>(
    name
      ? apiPath(['finance', 'identities', 'records'], {
          record_kind: kind,
          record_key: name,
          year,
          page_size: 1,
        })
      : null,
  );
}

/** 1 confirmation as `GET /finance/identities/{id}` serves it (only what is printed). */
export interface IdentityConfirmationRead {
  record_kind: string;
  record_key: string;
  status: 'confirmed' | 'withdrawn' | string;
  checked_at: string | null;
}

export interface IdentityRead {
  id: string;
  kind: string;
  name: string;
  confirmations?: IdentityConfirmationRead[];
}

/** The day this identity's standing confirmations of exactly this spelling were
 * checked, only when they were all checked the same day; several days are not
 * folded into 1. */
export function checkedDay(
  identity: IdentityRead | null,
  kinds: readonly string[],
  name: string,
  dayOf: (iso: string) => string,
): string | null {
  const days = new Set(
    (identity?.confirmations ?? [])
      .filter(
        (item) =>
          item.status === 'confirmed' &&
          kinds.includes(item.record_kind) &&
          item.record_key === name &&
          item.checked_at,
      )
      .map((item) => dayOf(item.checked_at!)),
  );
  return days.size === 1 ? [...days][0] : null;
}

/** "Confirmed for {k} of {n} records" (Confirm Identities wording, build notes
 * Round 20), only when the identity covers some of the name's records but not all.
 * A confirmation covers the records chosen, never the spelling as a whole. */
export function partialLine(identity: IdentitySummary, records: number): string | null {
  return identity.confirmed < records
    ? `Confirmed for ${identity.confirmed.toLocaleString('en-US')} of ${records.toLocaleString('en-US')} records`
    : null;
}
