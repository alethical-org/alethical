import { useEffect, useRef, useState, type FormEvent } from 'react';

import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import {
  groupNote,
  NAME_SEARCH_EMPTY_QUERY_TITLE,
  NO_MATCH_WHY,
  GROUP_UNAVAILABLE,
  tooShortTitle,
  tooShortWhy,
} from '@alethical/shared/moneyNameSearch';
import { paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';

import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { BackLink, SourcesAndUpdates } from '../ui/parts';
import './raceAndRecipients.css';

/** The money search's floor (its served `min_query_length`) and its ceiling per group. */
export const MIN_QUERY_LENGTH = 3;
export const SEARCH_LIMIT = 50;
/** The search endpoint refuses a longer name (q max_length 200). */
const MAX_QUERY = 200;
/** Rows per page, as drawn. */
export const PAGE_SIZE = 10;

/**
 * The 2 payment files whose payee names this page searches. They are 2 separate
 * filings that overlap, so their names and counts are never combined: each tab
 * reads its own group of `/campaign-finance/search`.
 */
export type RecipientTab = 'spending' | 'outside';

const TABS: ReadonlyArray<{
  value: RecipientTab;
  label: string;
  group: 'got_paid' | 'got_paid_independent';
}> = [
  { value: 'spending', label: 'Campaign spending', group: 'got_paid' },
  { value: 'outside', label: 'Outside spending', group: 'got_paid_independent' },
];

export function tabFromParam(raw: string): RecipientTab {
  return TABS.find((tab) => tab.value === raw)?.value ?? 'spending';
}

export function pageFromParam(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1;
}

export interface NameResult {
  kind: string;
  name?: string;
  role?: string;
  payment_count?: number | null;
}

export interface NameGroup {
  kind: string;
  state: string;
  results: NameResult[];
  total: number | null;
  at_least: number | null;
  has_more: boolean;
  fetched_at?: string | null;
  reason: string | null;
}

export interface NameSearch {
  state: string;
  q: string;
  min_query_length: number | null;
  groups: NameGroup[];
}

interface MoneySummary {
  freshness?: {
    payment_copied_at?: {
      expenditures?: string | null;
      independent_expenditures?: string | null;
    } | null;
  } | null;
}

export interface Recipient {
  name: string;
  records: number | null;
}

/** The recipients 1 file's group serves, in its own order (filed name A to Z). */
export function recipientsOf(group: NameGroup | undefined): Recipient[] {
  return (group?.results ?? [])
    .filter((result) => Boolean(result.name))
    .map((result) => ({ name: result.name as string, records: result.payment_count ?? null }));
}

/** A tab's count: the group's exact total, or the floor it counted to. */
export function tabCount(group: NameGroup | undefined): string | null {
  if (!group || group.state === 'unavailable') return null;
  if (group.total !== null) return formatCount(group.total);
  if (group.at_least !== null) return `${formatCount(group.at_least)}+`;
  return null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * "12 recipients · 40 payment records matching “acme”". The records are counted
 * only when every matching name is listed; a capped total is said as a floor,
 * never as a count.
 */
export function countLine(group: NameGroup, query: string): string {
  const matching = ` matching “${query}”`;
  if (group.total === null) {
    const floor = group.at_least ?? group.results.length;
    return `More than ${formatCount(floor)} recipients${matching}`;
  }
  const names = `${formatCount(group.total)} ${plural(group.total, 'recipient', 'recipients')}`;
  const complete = !group.has_more && group.results.every((item) => item.payment_count != null);
  if (!complete) return `${names}${matching}`;
  const records = group.results.reduce((sum, item) => sum + (item.payment_count ?? 0), 0);
  return `${names} · ${formatCount(records)} payment ${plural(records, 'record', 'records')}${matching}`;
}

/** "{n} payment records" for a phone row. */
export function recordsLine(records: number | null): string {
  if (records === null) return 'Payment records not counted';
  return `${formatCount(records)} payment ${plural(records, 'record', 'records')}`;
}

/** The page count for this many rows. */
export function pageCount(rows: number): number {
  return Math.max(1, Math.ceil(rows / PAGE_SIZE));
}

/**
 * The bottom line: both payment files' copy date in the drawing's words when they
 * match, otherwise each file's own date. A date the server did not serve is left out.
 */
export function sourceLines(summary: MoneySummary | null): string[] {
  const copied = summary?.freshness?.payment_copied_at;
  if (!copied) return [];
  const spending = copied.expenditures ? centralDateLabel(copied.expenditures) : null;
  const outside = copied.independent_expenditures
    ? centralDateLabel(copied.independent_expenditures)
    : null;
  if (spending && spending === outside) {
    return [
      `Payment records from the expenditure and independent expenditure files, copied ${spending}.`,
    ];
  }
  return [
    paymentFileCopyLine('expenditures', copied.expenditures),
    paymentFileCopyLine('independentExpenditures', copied.independent_expenditures),
  ];
}

/** Not in the drawing: the search serves only its first 50 names A to Z. */
export const FIRST_NAMES_ONLY =
  'Only the first 50 names, A to Z, are listed. Type more of the name to narrow the list.';

/**
 * Vendors and payees (Vendors and Payees drawing): recipients named in payment
 * records, searched by the filed name. The 2 payment files are separate tabs whose
 * names and counts are never combined. Every row is a printed name: no vendor
 * classification is inferred (decision D22), so no Confirmed vendors tab exists.
 */
export function Recipients(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const band = useBand();
  const [address, setAddress] = useAddressState({ q: '', tab: 'spending', page: '1' });
  const submitted = address.q.trim().slice(0, MAX_QUERY);
  const tab = tabFromParam(address.tab);
  const page = pageFromParam(address.page);

  const [typed, setTyped] = useState(submitted);
  // Back, Forward or a new link changes the address: the field follows it.
  useEffect(() => setTyped(submitted), [submitted]);

  const searchable = submitted.length >= MIN_QUERY_LENGTH;
  const read = useRead<NameSearch>(
    searchable
      ? apiPath(['campaign-finance', 'search'], { q: submitted, limit: SEARCH_LIMIT })
      : null,
    { keepPrevious: true },
  );
  const summary = useRead<MoneySummary>('campaign-finance/summary');

  const answer = searchable ? read.data : null;
  const groupOf = (value: RecipientTab) =>
    answer?.groups.find((group) => group.kind === TABS.find((item) => item.value === value)?.group);
  const group = groupOf(tab);
  const rows = recipientsOf(group);
  const pages = pageCount(rows.length);
  const shownPage = Math.min(page, pages);
  const slice = rows.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE);
  const groupFailed = group !== undefined && group.state === 'unavailable';
  const shownQuery = answer?.q ?? submitted;

  const list = useRef<HTMLElement>(null);
  function goPage(next: number) {
    setAddress({ page: String(next) });
    const element = list.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    element.querySelector<HTMLAnchorElement>('[role="row"] a')?.focus({ preventScroll: true });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddress({ q: typed.trim().slice(0, MAX_QUERY), page: '1' });
  }

  const freshFailure = searchable && read.failed && read.data === null;
  const retainedFailure = searchable && read.failed && read.data !== null;
  const isPhone = band === 'phone';
  const sources = sourceLines(summary.data);
  const payeeHref = (name: string) =>
    isBuilt('payments-under-name')
      ? withFrom(hrefFor('payments-under-name', { query: name }, { role: 'payee' }), here)
      : null;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && (
          <div className="vp-back">
            <BackLink to={back.to} name={back.name} />
          </div>
        )}
        <header className="vp-header">
          <h1 tabIndex={-1} className="f-page-title">
            Vendors and payees
          </h1>
          <p className="vp-dek">Find recipients named in payment records</p>
        </header>

        <form role="search" onSubmit={submit} className="vp-search">
          <label htmlFor="recipient-q" className="f-visually-hidden">
            Search recipients
          </label>
          <input
            id="recipient-q"
            type="search"
            className="f-field vp-field"
            value={typed}
            maxLength={MAX_QUERY}
            autoComplete="off"
            placeholder="Search recipients"
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" className="f-btn vp-submit">
            Search
          </button>
        </form>

        {answer && (
          <div className="vp-tabs">
            <Tabs
              label="Payment file"
              value={tab}
              tabs={TABS.map((item) => ({
                value: item.value,
                label: item.label,
                count: tabCount(groupOf(item.value)),
              }))}
              onChange={(next) => setAddress({ tab: next, page: '1' })}
            />
          </div>
        )}

        <section ref={list} aria-label="Recipients" className="vp-list">
          {!submitted && <Empty title={NAME_SEARCH_EMPTY_QUERY_TITLE} />}
          {submitted && !searchable && (
            <Empty title={tooShortTitle(MIN_QUERY_LENGTH)} next={tooShortWhy(MIN_QUERY_LENGTH)} />
          )}
          {searchable && read.loading && <LoadingRows />}
          {freshFailure && (
            <Refused onRetry={read.retry} retrying={read.pending}>
              We couldn’t load these results
            </Refused>
          )}
          {answer && (
            <>
              {read.updating && (
                <div className="vp-notice">
                  <Updating />
                </div>
              )}
              {retainedFailure && (
                <div className="vp-notice">
                  <Refused onRetry={read.retry} retrying={read.pending}>
                    We couldn’t update these results
                  </Refused>
                </div>
              )}
              {groupFailed || !group ? (
                <Refused onRetry={read.retry} retrying={read.pending}>
                  {GROUP_UNAVAILABLE}
                </Refused>
              ) : (
                <>
                  <div aria-live="polite" className="vp-count f-num">
                    {rows.length > 0 ? countLine(group, shownQuery) : ''}
                  </div>
                  {rows.length === 0 ? (
                    <Empty title="No matching records" next={NO_MATCH_WHY} />
                  ) : (
                    <>
                      <div
                        role="table"
                        aria-label="Recipients"
                        className="vp-table"
                        data-stale={read.updating || undefined}
                      >
                        {!isPhone && (
                          <div role="row" className="vp-row vp-head">
                            <span role="columnheader">RECIPIENT</span>
                            <span role="columnheader">RECORD TYPE</span>
                            <span role="columnheader" className="vp-records">
                              PAYMENT RECORDS
                            </span>
                          </div>
                        )}
                        {slice.map((row) => {
                          const href = payeeHref(row.name);
                          const name = href ? (
                            <Link to={href} className="vp-name-link">
                              {row.name}
                            </Link>
                          ) : (
                            <span>{row.name}</span>
                          );
                          if (isPhone) {
                            return (
                              <div role="row" key={row.name} className="vp-phone-row">
                                <span role="cell" className="vp-name f-marked">
                                  <RecordMark kind="printed" />
                                  {name}
                                </span>
                                <span role="cell" className="vp-phone-line f-num">
                                  Printed name · {recordsLine(row.records)}
                                </span>
                              </div>
                            );
                          }
                          return (
                            <div role="row" key={row.name} className="vp-row">
                              <span role="cell" className="vp-name f-marked">
                                <RecordMark kind="printed" />
                                {name}
                              </span>
                              <span role="cell">
                                <span className="vp-tag">Printed name</span>
                              </span>
                              <span role="cell" className="vp-records f-num">
                                {row.records === null ? '' : formatCount(row.records)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {group.has_more && <p className="vp-more">{FIRST_NAMES_ONLY}</p>}
                      <nav aria-label="Pages" className="vp-pager">
                        <button
                          type="button"
                          className="f-btn f-btn-secondary vp-page-btn"
                          aria-disabled={shownPage <= 1 || undefined}
                          onClick={() => shownPage > 1 && goPage(shownPage - 1)}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M15 5 L8 12 L15 19"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Previous
                        </button>
                        <span aria-live="polite" className="vp-page-line f-num">
                          Page {formatCount(shownPage)} of {formatCount(pages)}
                        </span>
                        <button
                          type="button"
                          className="f-btn f-btn-secondary vp-page-btn"
                          aria-disabled={shownPage >= pages || undefined}
                          onClick={() => shownPage < pages && goPage(shownPage + 1)}
                        >
                          Next
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M9 5 L16 12 L9 19"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </nav>
                    </>
                  )}
                  <p className="vp-basis">
                    A recipient is not a vendor unless confirmed.{' '}
                    {groupNote(TABS.find((item) => item.value === tab)!.group)}
                  </p>
                </>
              )}
            </>
          )}
        </section>
      </div>
      <SourcesAndUpdates>
        {sources.length > 0
          ? sources.map((line) => (
              <p key={line} className="f-sources-line f-num">
                {line}
              </p>
            ))
          : null}
      </SourcesAndUpdates>
    </main>
  );
}
