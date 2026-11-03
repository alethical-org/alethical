import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatMoney } from '@alethical/shared/moneyFormat';
import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import { paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';
import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { ClearAll, Dropdown, Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { BackLink, Chevron, SourcesAndUpdates } from '../ui/parts';
import { periodOf } from './organization/data';
import './raceAndRecipients.css';

export const PAGE_SIZE = 10;
export type RecipientTab = 'all' | 'confirmed' | 'printed';
export type RecipientSort = 'name' | 'amount' | 'records';

export interface Recipient {
  key: string;
  name: string;
  record_kind: 'confirmed_vendor' | 'confirmed_person' | 'printed_name';
  identity: { id: string; kind: string; name: string } | null;
  role: 'vendor' | 'independent_vendor';
  dataset: string;
  payment_count: number;
  amount: string | null;
  amount_state: 'reported' | 'incomplete' | 'incomplete_period';
  period_basis: 'dates' | 'years' | 'unknown';
  first_year: number | null;
  last_year: number | null;
  first_payment_on: string | null;
  last_payment_on: string | null;
  undated_payment_count: number;
  source_url: string | null;
  snapshot_id: string | null;
  fetched_at: string | null;
}

export interface RecipientsPage {
  state: string;
  rows: Recipient[];
  total: number | null;
  payment_count: number | null;
  has_more: boolean;
  limit: number;
  offset: number;
  years: number[];
  payment_types: string[];
  counts?: { all: number | null; confirmed: number | null; printed: number | null };
  sources: Array<{ dataset: string; fetched_at: string | null; source_url: string | null }>;
  q?: string;
  tab?: string;
  year?: number | null;
  payment_type?: string | null;
}

const DATE_MISSING = 'Date not given in the public file';

/** The sort the address names. The earlier "Itemized amount" sort opens as Largest
 * total first (Design Round 31). */
export function sortFromParam(raw: string): RecipientSort {
  if (raw === 'amount' || raw === 'Itemized amount') return 'amount';
  if (raw === 'records') return 'records';
  return 'name';
}

/** A confirmed identity opens its profile; a printed name opens its payments in the
 * payee role, at the selected year (Design Round 37). A profile route that is not
 * built gets no link, never a link to a page that answers "not found". */
export function recipientHref(row: Recipient, year = ''): string | null {
  if (row.identity) {
    const route = row.identity.kind === 'person' ? 'person' : 'organization';
    return isBuilt(route) ? hrefFor(route, { id: row.identity.id }) : null;
  }
  if (!isBuilt('payments-under-name')) return null;
  return hrefFor(
    'payments-under-name',
    { query: row.name },
    {
      role: 'payee',
      year: year || null,
      section: row.role === 'vendor' ? 'campaign-payments' : 'outside-payments',
    },
  );
}

/** The shared total rule (Design Rounds 36 and 41): a missing amount withholds the
 * total first; a total needs every date or every filing year. Under the amount
 * heading a withheld total reads "Incomplete"; a phone row, with no heading, reads
 * "Missing payment amount". */
export function recipientAmount(row: Recipient, phone = false): string {
  if (row.amount_state === 'incomplete') return phone ? 'Missing payment amount' : 'Incomplete';
  if (row.amount_state === 'incomplete_period' || row.period_basis === 'unknown') {
    return 'Reporting period incomplete';
  }
  return formatMoney(row.amount) ?? 'Amount not given';
}

/** Dates when every payment carries one, else the stored filing years, labelled as
 * such (Design Round 41); a filing year is never read off a payment date. */
export function recipientPeriod(row: Recipient): string {
  if (row.period_basis === 'dates') {
    return periodOf([row.first_payment_on, row.last_payment_on]) ?? DATE_MISSING;
  }
  if (row.period_basis === 'years' && row.first_year !== null && row.last_year !== null) {
    return row.first_year === row.last_year
      ? `Filing year ${row.first_year}`
      : `Filing years ${row.first_year}–${row.last_year}`;
  }
  return DATE_MISSING;
}

export function recipientKind(row: Recipient): 'Organization' | 'Person' | 'Printed name' {
  if (row.record_kind === 'confirmed_vendor') return 'Organization';
  if (row.record_kind === 'confirmed_person') return 'Person';
  return 'Printed name';
}

export function datasetLabel(row: Recipient): string {
  return row.role === 'vendor' ? 'Expenditure file' : 'Independent expenditure file';
}

/** 1 line when both files were copied the same day, else 1 line per file; a file
 * with no copy date borrows no other file's. */
export function sourceLines(sources: RecipientsPage['sources'] | undefined): string[] {
  const of = (dataset: string) =>
    sources?.find((source) => source.dataset === dataset)?.fetched_at ?? null;
  const spending = of('expenditures');
  const outside = of('independent_expenditures');
  if (spending && outside && centralDateLabel(spending) === centralDateLabel(outside)) {
    return [
      `Payment records from the expenditure and independent expenditure files, copied ${centralDateLabel(spending)}`,
    ];
  }
  return [
    paymentFileCopyLine('expenditures', spending),
    paymentFileCopyLine('independentExpenditures', outside),
  ];
}

export function countLine(data: RecipientsPage, tab: RecipientTab): string {
  const total = data.total ?? 0;
  const noun =
    tab === 'printed'
      ? total === 1
        ? 'printed name'
        : 'printed names'
      : tab === 'confirmed'
        ? total === 1
          ? 'organization'
          : 'organizations'
        : total === 1
          ? 'recipient'
          : 'recipients';
  const records = data.payment_count ?? 0;
  return `${formatCount(total)} ${noun} · ${formatCount(records)} payment ${records === 1 ? 'record' : 'records'}${data.q ? ` matching “${data.q}”` : ''}`;
}

/**
 * Vendors and payees (Vendors and Payees drawing): every payee printed in the
 * expenditure and independent-expenditure files, searched, filtered, sorted and
 * paged on the server (`/finance/payees`). Groups are 1 per source file, printed
 * name and record-level identity; the 2 files never merge. A printed name is a
 * string, never a vendor, until a confirmation covers its records.
 */
export function Recipients(_props: { match: RouteMatch }) {
  const location = useLocation(),
    here = location.pathname + location.search,
    back = returnTarget(location.search),
    phone = useBand() === 'phone';
  const [state, setState] = useAddressState({
    q: '',
    tab: 'all',
    year: '',
    type: '',
    sort: 'name',
    page: '1',
  });
  const tab: RecipientTab =
    state.tab === 'confirmed' || state.tab === 'printed' ? state.tab : 'all';
  const page = Math.max(1, Math.trunc(Number(state.page) || 1));
  const sort = sortFromParam(state.sort);
  const [typed, setTyped] = useState(state.q);
  useEffect(() => setTyped(state.q), [state.q]);
  const read = useRead<RecipientsPage>(
    apiPath(['finance', 'payees'], {
      q: state.q.trim().slice(0, 200),
      tab,
      year: state.year,
      payment_type: state.type,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    { keepPrevious: true, acceptData: (data) => data.state !== 'unavailable' },
  );
  const data = read.data?.state === 'unavailable' ? null : read.data,
    rows = data?.rows ?? [],
    pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)),
    shownPage = data ? Math.floor(data.offset / PAGE_SIZE) + 1 : page;
  const list = useRef<HTMLElement>(null);
  function goPage(next: number) {
    if (read.pending) return;
    setState({ page: String(next) });
    list.current?.focus({ preventScroll: true });
    list.current?.scrollIntoView?.({ block: 'start' });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setState({ q: typed.trim(), page: '1' });
  }
  const filtered = state.year !== '' || state.type !== '' || sort !== 'name';
  const noPrevious = shownPage <= 1;
  const noNext = !data?.has_more;
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
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
            maxLength={200}
            autoComplete="off"
            placeholder="Search recipients"
            onChange={(e) => setTyped(e.target.value)}
          />
          <button className="f-btn vp-submit">Search</button>
        </form>
        <div className="vp-tabs">
          <Tabs
            label="Recipient type"
            value={tab}
            tabs={[
              {
                value: 'all',
                label: 'All recipients',
                count: data?.counts?.all != null ? formatCount(data.counts.all) : null,
              },
              {
                value: 'confirmed',
                label: 'Confirmed vendors',
                count: data?.counts?.confirmed != null ? formatCount(data.counts.confirmed) : null,
              },
              {
                value: 'printed',
                label: 'Printed names',
                count: data?.counts?.printed != null ? formatCount(data.counts.printed) : null,
              },
            ]}
            onChange={(tab) => setState({ tab, page: '1' })}
          />
        </div>
        <div className="vp-controls">
          <Dropdown
            name="Year"
            value={state.year}
            options={[
              { value: '', label: 'All years' },
              ...(data?.years ?? []).map((y) => ({ value: String(y), label: String(y) })),
            ]}
            onChange={(year) => setState({ year, page: '1' })}
          />
          <Dropdown
            name="Payment type"
            value={state.type}
            options={[
              { value: '', label: 'All payment types' },
              ...(data?.payment_types ?? []).map((t) => ({ value: t, label: t })),
            ]}
            onChange={(type) => setState({ type, page: '1' })}
          />
          <Dropdown<RecipientSort>
            name="Sort by"
            value={sort}
            options={[
              { value: 'name', label: 'Name A–Z' },
              { value: 'amount', label: 'Largest total first' },
              { value: 'records', label: 'Payment records' },
            ]}
            onChange={(sort) => setState({ sort, page: '1' })}
          />
          {filtered && (
            <ClearAll onClick={() => setState({ year: '', type: '', sort: 'name', page: '1' })} />
          )}
        </div>
        <section ref={list} tabIndex={-1} aria-label="Recipients" className="vp-list">
          {read.loading && <LoadingRows />}
          {read.updating && (
            <div className="vp-notice">
              <Updating />
            </div>
          )}
          {(read.failed || read.data?.state === 'unavailable') && (
            <div className="vp-notice">
              <Refused onRetry={read.retry} retrying={read.pending}>
                {data ? 'We couldn’t update these results' : 'We couldn’t load these results'}
              </Refused>
            </div>
          )}
          {data && (
            <>
              <div className="vp-count f-count-line" aria-live="polite">
                {countLine(data, tab)}
              </div>
              {!rows.length && !read.updating ? (
                <Empty title="No matching records" />
              ) : (
                <>
                  <div
                    role="table"
                    aria-label="Recipients"
                    className="vp-table"
                    data-stale={read.updating || undefined}
                  >
                    {!phone && (
                      <div role="row" className="vp-row vp-head">
                        <span role="columnheader">RECIPIENT</span>
                        <span role="columnheader">RECORD TYPE</span>
                        <span role="columnheader" className="vp-records">
                          PAYMENT RECORDS
                        </span>
                        <span role="columnheader" className="vp-records">
                          ITEMIZED AMOUNT
                        </span>
                        <span role="columnheader">PERIOD</span>
                      </div>
                    )}
                    {rows.map((row) =>
                      phone ? (
                        <PhoneRow key={row.key} row={row} year={state.year} here={here} />
                      ) : (
                        <Row key={row.key} row={row} year={state.year} here={here} />
                      ),
                    )}
                  </div>
                  <nav aria-label="Pages" className="vp-pager">
                    <button
                      type="button"
                      className="f-btn f-btn-secondary vp-page-btn vp-page-prev"
                      aria-disabled={noPrevious || undefined}
                      onClick={() => !noPrevious && goPage(shownPage - 1)}
                    >
                      <Chevron />
                      Previous
                    </button>
                    <span className="vp-page-line f-num" aria-live="polite">
                      Page {shownPage} of {pages}
                    </span>
                    <button
                      type="button"
                      className="f-btn f-btn-secondary vp-page-btn vp-page-next"
                      aria-disabled={noNext || undefined}
                      onClick={() => !noNext && goPage(shownPage + 1)}
                    >
                      Next
                      <Chevron />
                    </button>
                  </nav>
                </>
              )}
              <p className="f-section-note vp-basis">
                A recipient is not a vendor unless confirmed; refunds keep their filed sign
              </p>
            </>
          )}
        </section>
      </div>
      <SourcesAndUpdates>
        {sourceLines(data?.sources).map((line) => (
          <p key={line} className="f-sources-line f-num">
            {line}
          </p>
        ))}
      </SourcesAndUpdates>
    </main>
  );
}

function Name({ row, year, here }: { row: Recipient; year: string; here: string }) {
  const href = recipientHref(row, year);
  return href ? (
    <Link to={withFrom(href, here)} className="vp-name-link">
      {row.name}
    </Link>
  ) : (
    <span className="vp-name-text">{row.name}</span>
  );
}

function Mark({ row }: { row: Recipient }) {
  return (
    <RecordMark
      kind={
        row.record_kind === 'confirmed_person'
          ? 'person'
          : row.record_kind === 'confirmed_vendor'
            ? 'organization'
            : 'printed'
      }
    />
  );
}

function Row({ row, year, here }: { row: Recipient; year: string; here: string }) {
  const withheld = row.amount_state !== 'reported' || row.amount === null;
  return (
    <div role="row" className="vp-row">
      <span role="cell" className="vp-name f-marked">
        <Mark row={row} />
        <span>
          <Name row={row} year={year} here={here} />
        </span>
      </span>
      <span role="cell" className="vp-kind">
        <span className="vp-tag" data-confirmed={row.identity ? true : undefined}>
          {recipientKind(row)}
        </span>
        <span className="vp-file">{datasetLabel(row)}</span>
      </span>
      <span role="cell" className="vp-records f-num">
        {formatCount(row.payment_count)}
      </span>
      <span role="cell" className="vp-amount f-num" data-missing={withheld || undefined}>
        {recipientAmount(row)}
      </span>
      <span role="cell" className="vp-period f-num">
        {recipientPeriod(row)}
      </span>
    </div>
  );
}

function PhoneRow({ row, year, here }: { row: Recipient; year: string; here: string }) {
  const withheld = row.amount_state !== 'reported' || row.amount === null;
  return (
    <div role="row" className="vp-phone-row">
      <div className="vp-phone-top">
        <span className="vp-name f-marked">
          <Mark row={row} />
          <span role="cell">
            <Name row={row} year={year} here={here} />
          </span>
        </span>
        <span role="cell" className="vp-amount f-num" data-missing={withheld || undefined}>
          {recipientAmount(row, true)}
        </span>
      </div>
      <div role="cell" className="vp-phone-line f-num">
        {recipientKind(row)} · {formatCount(row.payment_count)} payment{' '}
        {row.payment_count === 1 ? 'record' : 'records'} · {recipientPeriod(row)}
      </div>
    </div>
  );
}
