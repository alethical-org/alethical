import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { STATUS_LABELS } from '@alethical/shared/billStatus';
import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { REQUEST_TIMEOUT_MS } from '../api/client';
import { useRead } from '../api/read';
import { useFinanceSession } from '../auth/session';
import type { ServedCounts } from '../landing/counts';
import { returnTarget, withFrom } from '../returnContext';
import { Link, useLocation } from '../router';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { billSession } from '../search/suggestions';
import { useAddressState } from '../ui/addressState';
import {
  ClearAll,
  Dropdown,
  Empty,
  LoadingRows,
  Refused,
  Updating,
  type Option,
} from '../ui/controls';
import { Arrow, BackLink, Chevron, SourcesAndUpdates, WithArrow } from '../ui/parts';
import {
  billCode,
  billHeading,
  billsApi,
  billStatus,
  dayLabel,
  fileChamber,
  sessionShortLabel,
  type BillListItem,
  type ServedSession,
} from './legislationRecords';
import './legislation.css';

export const BILLS_PAGE_SIZE = 20;

const CHAMBERS: ReadonlyArray<Option<string>> = [
  { value: '', label: 'Both chambers' },
  { value: 'house', label: 'House' },
  { value: 'senate', label: 'Senate' },
];

const STATUSES: ReadonlyArray<Option<string>> = [
  { value: '', label: 'Any status' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

export interface BillFilters {
  q: string;
  session: string;
  chamber: string;
  status: string;
}

/** A page number from the address; anything else opens page 1. */
export function pageNumber(raw: string): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/** The server pages, searches and filters; the browser never does. */
export function billsPath(filters: BillFilters, page: number): string {
  const params = new URLSearchParams({
    limit: String(BILLS_PAGE_SIZE),
    offset: String((page - 1) * BILLS_PAGE_SIZE),
  });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.session) params.set('session', filters.session);
  if (filters.chamber) params.set('chamber', filters.chamber);
  if (filters.status) params.set('status', filters.status);
  return `${billsApi()}?${params.toString()}`;
}

/** "4,012 bills · 2025–26 session", or the count alone when the session's
 * name could not be read. */
export function billCountLine(total: number, session: string | null): string {
  const count = `${total.toLocaleString('en-US')} ${total === 1 ? 'bill' : 'bills'}`;
  return session ? `${count} · ${session} session` : count;
}

export function billPages(total: number | null): number {
  return Math.max(1, Math.ceil((total ?? 0) / BILLS_PAGE_SIZE));
}

// ---------- The list read ----------

interface ListAnswer {
  rows: BillListItem[];
  total: number | null;
}

type ListOutcome =
  { state: 'ok'; answer: ListAnswer } | { state: 'not-found' } | { state: 'failed' };

/** 1 GET of a bill list, keeping the served total that `useRead` leaves out. */
async function readList(
  apiBaseUrl: string,
  path: string,
  accessToken: string | null,
  signal: AbortSignal,
): Promise<ListOutcome> {
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
      // A public read: no account token, so it stays cacheable (src/api/read.ts).
      signal:
        timeout && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([signal, timeout])
          : signal,
    });
    if (response.status === 404) return { state: 'not-found' };
    if (!response.ok) return { state: 'failed' };
    const body = (await response.json()) as {
      data?: unknown;
      page?: { total?: unknown } | null;
    } | null;
    if (!body || !Array.isArray(body.data)) return { state: 'failed' };
    const total = body.page?.total;
    return {
      state: 'ok',
      answer: {
        rows: body.data as BillListItem[],
        total: typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null,
      },
    };
  } catch {
    return { state: 'failed' };
  }
}

const LIST_CACHE_MS = 60_000;
const listCache = new Map<string, { at: number; answer: ListAnswer }>();

/**
 * The bill list for 1 view. The shared `useRead` returns a response's `data`
 * only, and this view needs the server's total too, so the list reads here with
 * the same rules: the last results stay visible while the next view loads, an
 * older answer never replaces a newer request's, and a recent answer is reused
 * for a minute so Back shows it at once. The cache key carries the account's
 * token, so nothing read for 1 account is shown to another.
 */
function useBillList(path: string) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const key = `${accessToken}|${path}`;
  const [answer, setAnswer] = useState<{ key: string; outcome: ListOutcome } | null>(() => {
    const held = listCache.get(key);
    return held ? { key, outcome: { state: 'ok', answer: held.answer } } : null;
  });
  const [last, setLast] = useState<ListAnswer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const held = listCache.get(key);
    if (held && Date.now() - held.at < LIST_CACHE_MS && attempt === 0) {
      setAnswer({ key, outcome: { state: 'ok', answer: held.answer } });
      setLast(held.answer);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    void readList(apiBaseUrl, path, accessToken, controller.signal).then((outcome) => {
      if (request !== latest.current) return;
      setPending(false);
      if (outcome.state === 'ok') {
        listCache.set(key, { at: Date.now(), answer: outcome.answer });
        setLast(outcome.answer);
      }
      setAnswer({ key, outcome });
    });
    return () => controller.abort();
  }, [apiBaseUrl, accessToken, key, path, attempt]);

  useEffect(() => setAttempt(0), [key]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const current = answer && answer.key === key ? answer.outcome : null;
  const own = current?.state === 'ok' ? current.answer : null;
  const notFound = current?.state === 'not-found';
  const shown = notFound ? { rows: [], total: 0 } : (own ?? last);
  return {
    own,
    shown,
    loading: shown === null && (current === null || pending),
    updating: own === null && !notFound && last !== null && (current === null || pending),
    failed: current?.state === 'failed' && !pending,
    pending,
    retry,
  };
}

/** Forget every held list: tests start clean. */
export function clearBillListCache() {
  listCache.clear();
}

// ---------- The page ----------

/** Legislation (Bills drawing): search, Session, Chamber and Status menus, and
 * the bill list, paged on the server. */
export function Legislation(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [address, setAddress] = useAddressState({
    q: '',
    session: '',
    chamber: '',
    status: '',
    page: '1',
  });
  const [draft, setDraft] = useState(address.q);
  useEffect(() => setDraft(address.q), [address.q]);
  const page = pageNumber(address.page);

  const sessions = useRead<ServedSession[]>('sessions');
  const counts = useRead<ServedCounts>('finance/landing/counts');
  const current = sessions.data?.find((session) => session.is_current) ?? null;
  // The current session is the default, so its own slug in the address means the same view.
  const sessionValue = current && address.session === current.slug ? '' : address.session;
  const chosen = sessionValue
    ? (sessions.data?.find((session) => session.slug === sessionValue) ?? null)
    : current;
  const chosenLabel = chosen ? sessionShortLabel(chosen) : null;
  const sessionOptions: Option<string>[] = (sessions.data ?? [])
    .slice()
    .sort((a, b) => Number(b.is_current) - Number(a.is_current))
    .map((session) => ({
      value: session.is_current ? '' : session.slug,
      label: sessionShortLabel(session),
    }));

  const filters = {
    q: address.q,
    session: sessionValue,
    chamber: address.chamber,
    status: address.status,
  };
  const list = useBillList(billsPath(filters, page));
  const total = list.shown?.total ?? null;
  const pages = billPages(total);
  const rows = list.shown?.rows ?? [];

  // A page past the end (a stale link, or a search that now matches fewer)
  // opens the last page that exists rather than an empty list.
  useEffect(() => {
    if (list.own && list.own.total !== null && page > billPages(list.own.total)) {
      setAddress({ page: String(billPages(list.own.total)) });
    }
  }, [list.own, page, setAddress]);

  // Paging moves focus and the view to the first row once that page arrives.
  const listRef = useRef<HTMLUListElement>(null);
  const focusFirst = useRef(false);
  useEffect(() => {
    if (!focusFirst.current || !list.own) return;
    focusFirst.current = false;
    const first = listRef.current?.querySelector<HTMLElement>('a, [tabindex]');
    first?.focus({ preventScroll: true });
    listRef.current?.scrollIntoView?.({ block: 'start' });
  }, [list.own]);

  function goTo(next: number) {
    if (next < 1 || next > pages || next === page) return;
    focusFirst.current = true;
    setAddress({ page: String(next) });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setAddress({ q: draft.trim(), page: '1' });
  }

  const filtered = sessionValue !== '' || address.chamber !== '' || address.status !== '';
  const copied = counts.data?.current_legislature_bills;
  const updated =
    copied?.state === 'reported' && copied.copied_at ? centralDateLabel(copied.copied_at) : null;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header>
          <h1 tabIndex={-1} className="f-page-title">
            Legislation
          </h1>
          <p className="lg-intro">
            Minnesota bills with their versions, actions, authors, committees and recorded roll
            calls.
          </p>
        </header>
        <form role="search" onSubmit={submit} className="lg-search">
          <label htmlFor="bills-q" className="f-visually-hidden">
            Search bills
          </label>
          <input
            id="bills-q"
            type="search"
            className="f-field lg-search-field"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search bills"
            autoComplete="off"
          />
          <button type="submit" className="f-btn lg-search-submit">
            Search
          </button>
        </form>

        <div className="lg-menus">
          {sessionOptions.length > 0 && (
            <Dropdown
              name="Session"
              value={sessionValue}
              options={sessionOptions}
              onChange={(value) => setAddress({ session: value, page: '1' })}
            />
          )}
          <Dropdown
            name="Chamber"
            value={address.chamber}
            options={CHAMBERS}
            onChange={(value) => setAddress({ chamber: value, page: '1' })}
          />
          <Dropdown
            name="Status"
            value={address.status}
            options={STATUSES}
            onChange={(value) => setAddress({ status: value, page: '1' })}
          />
          {filtered && (
            <ClearAll
              onClick={() => setAddress({ session: '', chamber: '', status: '', page: '1' })}
            />
          )}
        </div>

        <div className="lg-results">
          {list.loading && <LoadingRows />}
          {list.failed && (
            <Refused onRetry={list.retry} retrying={list.pending}>
              We couldn’t load these results. This is a problem on our side.
            </Refused>
          )}
          {list.updating && !list.failed && <Updating />}
          {list.shown && (
            <>
              <div aria-live="polite" className="lg-count">
                {total !== null ? billCountLine(total, chosenLabel) : null}
              </div>
              {rows.length === 0 ? (
                <Empty title="No matching records" next="Try another name or bill number" />
              ) : (
                <>
                  <ul ref={listRef} className="lg-list">
                    {rows.map((bill) => (
                      <BillRow
                        key={bill.id}
                        bill={bill}
                        session={chosenLabel ?? billSession(bill.id)}
                        here={here}
                      />
                    ))}
                  </ul>
                  <p className="lg-note">
                    Status and date are the latest recorded action from the Legislature. A vote
                    result differs from a bill’s eventual status.
                  </p>
                  {pages > 1 && (
                    <nav aria-label="Pages" className="lg-pager">
                      <button
                        type="button"
                        className="f-btn f-btn-secondary lg-pager-button"
                        aria-disabled={page <= 1 || undefined}
                        onClick={() => goTo(page - 1)}
                      >
                        <Chevron />
                        Previous
                      </button>
                      <span aria-live="polite" className="lg-pager-line">
                        Page {page.toLocaleString('en-US')} of {pages.toLocaleString('en-US')}
                      </span>
                      <button
                        type="button"
                        className="f-btn f-btn-secondary lg-pager-button lg-pager-next"
                        aria-disabled={page >= pages || undefined}
                        onClick={() => goTo(page + 1)}
                      >
                        Next
                        <ChevronRight />
                      </button>
                    </nav>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <SourcesAndUpdates>
        <p className="f-sources-line">
          Minnesota Legislature · revisor.mn.gov{updated ? ` · Updated ${updated}` : ''}
        </p>
        <a
          href="https://www.revisor.mn.gov/bills/"
          target="_blank"
          rel="noopener noreferrer"
          className="f-dest f-sources-link"
        >
          <span>
            <WithArrow>Official source website</WithArrow>
          </span>
          <span className="f-visually-hidden"> (opens in a new tab)</span>
        </a>
      </SourcesAndUpdates>
    </main>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5 L16 12 L9 19"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BillRow({
  bill,
  session,
  here,
}: {
  bill: BillListItem;
  session: string | null;
  here: string;
}) {
  const code = billCode(bill.file_type, bill.file_number, bill.id);
  const meta = [
    session,
    fileChamber(code),
    billStatus(bill.status_key, bill.current_status),
    dayLabel(bill.latest_action_at),
  ].filter(Boolean);
  const content = (
    <>
      {code && <span className="f-code lg-code">{code}</span>}
      <span className="lg-row-text">
        <span className="lg-row-title">{billHeading(bill.ai_analysis?.short_title, code)}</span>
        <span className="lg-row-meta">{meta.join(' · ')}</span>
      </span>
      <Arrow />
    </>
  );
  return (
    <li>
      {isBuilt('bill') ? (
        <Link to={withFrom(hrefFor('bill', { id: bill.id }), here)} className="lg-row">
          {content}
        </Link>
      ) : (
        <div className="lg-row">{content}</div>
      )}
    </li>
  );
}
