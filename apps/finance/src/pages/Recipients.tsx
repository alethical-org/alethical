import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatMoney } from '@alethical/shared/moneyFormat';
import { formatCount } from '@alethical/shared/moneyLanding';
import { paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';
import { apiPath, useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { ClearAll, Dropdown, Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { BackLink, SourcesAndUpdates } from '../ui/parts';
import { periodOf } from './organization/data';
import './raceAndRecipients.css';
export const PAGE_SIZE = 10;
export type RecipientTab = 'all' | 'confirmed' | 'printed';
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
export function recipientHref(row: Recipient) {
  return row.identity
    ? hrefFor(row.identity.kind === 'person' ? 'person' : 'organization', { id: row.identity.id })
    : hrefFor(
        'payments-under-name',
        { query: row.name },
        {
          role: 'payee',
          section: row.role === 'vendor' ? 'campaign-payments' : 'outside-payments',
        },
      );
}
export function recipientAmount(row: Recipient) {
  if (row.amount_state === 'incomplete_period' || row.period_basis === 'unknown')
    return 'Amount unavailable: payment period is incomplete';
  return row.amount_state === 'reported'
    ? (formatMoney(row.amount) ?? 'Amount not given')
    : 'Incomplete: a payment amount is missing';
}
export function recipientPeriod(row: Recipient) {
  const known =
    row.period_basis === 'years' && row.first_year !== null && row.last_year !== null
      ? row.first_year === row.last_year
        ? `Year ${row.first_year}`
        : `Years ${row.first_year}–${row.last_year}`
      : row.period_basis === 'dates'
        ? periodOf([row.first_payment_on, row.last_payment_on])
        : null;
  return [
    known ?? 'Period not available for every payment',
    row.undated_payment_count
      ? `${formatCount(row.undated_payment_count)} undated payment ${row.undated_payment_count === 1 ? 'record' : 'records'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
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
  const sort = ['name', 'amount', 'records'].includes(state.sort) ? state.sort : 'name';
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
    pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const list = useRef<HTMLElement>(null);
  function goPage(next: number) {
    setState({ page: String(next) });
    list.current?.focus({ preventScroll: true });
    list.current?.scrollIntoView?.({ block: 'start' });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setState({ q: typed.trim(), page: '1' });
  }
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
          <Dropdown
            name="Sort by"
            value={sort}
            options={[
              { value: 'name', label: 'Name A–Z' },
              { value: 'amount', label: 'Itemized amount' },
              { value: 'records', label: 'Payment records' },
            ]}
            onChange={(sort) => setState({ sort, page: '1' })}
          />
          {(state.year || state.type || sort !== 'name') && (
            <ClearAll onClick={() => setState({ year: '', type: '', sort: 'name', page: '1' })} />
          )}
        </div>
        <section ref={list} tabIndex={-1} aria-label="Recipients" className="vp-list">
          {read.loading && <LoadingRows />}
          {read.updating && <Updating />}
          {(read.failed || read.data?.state === 'unavailable') && (
            <Refused onRetry={read.retry} retrying={read.pending}>
              {data ? 'We couldn’t update these results' : 'We couldn’t load these results'}
            </Refused>
          )}
          {data && (
            <>
              <div className="vp-count f-num" aria-live="polite">
                {formatCount(data.total ?? 0)} {data.total === 1 ? 'recipient' : 'recipients'} ·{' '}
                {formatCount(data.payment_count ?? 0)} payment{' '}
                {data.payment_count === 1 ? 'record' : 'records'}
                {data.q ? ` matching “${data.q}”` : ''}
              </div>
              {!rows.length && !read.updating ? (
                <Empty title="No matching records" />
              ) : (
                <div
                  role="table"
                  aria-label="Recipients"
                  className="vp-table"
                  data-stale={read.updating || undefined}
                >
                  {!phone && (
                    <div role="row" className="vp-row vp-head vp-full">
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
                  {rows.map((row) => (
                    <div
                      role="row"
                      key={row.key}
                      className={phone ? 'vp-phone-row' : 'vp-row vp-full'}
                    >
                      <span role="cell" className="vp-name f-marked">
                        <RecordMark
                          kind={
                            row.identity?.kind === 'person'
                              ? 'person'
                              : row.identity
                                ? 'organization'
                                : 'printed'
                          }
                        />
                        <span>
                          <Link to={withFrom(recipientHref(row), here)} className="vp-name-link">
                            {row.name}
                          </Link>
                          <span className="vp-file">
                            {row.role === 'vendor'
                              ? 'Campaign payments'
                              : 'Outside spending payments'}
                          </span>
                        </span>
                      </span>
                      <span role="cell">
                        <span className="vp-tag" data-confirmed={row.identity ? true : undefined}>
                          {row.record_kind === 'confirmed_vendor'
                            ? 'Confirmed vendor'
                            : row.record_kind === 'confirmed_person'
                              ? 'Person'
                              : 'Printed name'}
                        </span>
                      </span>
                      <span role="cell" className="vp-records f-num">
                        {formatCount(row.payment_count)}
                        {phone
                          ? ' payment ' + (row.payment_count === 1 ? 'record' : 'records')
                          : ''}
                      </span>
                      <span
                        role="cell"
                        className="vp-amount f-num"
                        data-missing={
                          row.amount_state !== 'reported' || row.amount === null || undefined
                        }
                      >
                        {recipientAmount(row)}
                      </span>
                      <span role="cell" className="vp-period f-num">
                        {recipientPeriod(row)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {pages > 1 && (
                <nav aria-label="Pages" className="vp-pager">
                  <button
                    className="f-btn f-btn-secondary vp-page-btn"
                    disabled={read.pending || page <= 1}
                    onClick={() => goPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span className="vp-page-line f-num">
                    Page {Math.floor(data.offset / PAGE_SIZE) + 1} of {pages}
                  </span>
                  <button
                    className="f-btn f-btn-secondary vp-page-btn"
                    disabled={read.pending || !data.has_more}
                    onClick={() => goPage(page + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
              <p className="vp-basis">
                A recipient is not a vendor unless confirmed; refunds keep their filed sign.
              </p>
            </>
          )}
        </section>
      </div>
      <SourcesAndUpdates>
        {['expenditures', 'independent_expenditures'].map((key) => (
          <p key={key} className="f-sources-line f-num">
            {paymentFileCopyLine(
              key === 'expenditures' ? 'expenditures' : 'independentExpenditures',
              data?.sources?.find((source) => source.dataset === key)?.fetched_at,
            )}
          </p>
        ))}
      </SourcesAndUpdates>
    </main>
  );
}
