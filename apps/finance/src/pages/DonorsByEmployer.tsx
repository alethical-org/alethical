import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { UNNAMED_PAYMENT_PARTY } from '@alethical/shared/committeeMoneyShared';
import { formatDay, formatMoney } from '../ui/money';
import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import {
  CAP_NEXT_LABEL,
  RECORDS_UNAVAILABLE_TITLE,
  RECORDS_UNAVAILABLE_WHY,
} from '@alethical/shared/paymentsUnderName';

import { apiGet, apiPath, useRead } from '../api/read';
import { useFinanceSession } from '../auth/session';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { Refused, Updating } from '../ui/controls';
import { BackLink, Chevron, SourcesAndUpdates, WithArrow } from '../ui/parts';
import { useRevealFocus } from '../ui/revealFocus';
import { tabOfKind } from './committee/data';
import { useIdentityRecords, type IdentityRecords, type ReceivedRow } from './payments/data';
import './payments.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const BOARD_FILES_URL =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
/** The server searches employer spellings from 3 characters. */
export const MIN_SEARCH = 3;
const SPELLINGS_PAGE = 50;
const DONORS_PAGE = 20;
const PAYMENTS_PAGE = 50;
const FAILED =
  'We couldn’t load these donors. This is a problem on our side and says nothing about what was filed under this employer.';

interface Paging {
  limit: number;
  offset: number;
  has_more: boolean;
}

/** 1 employer spelling in `GET /finance/employers` (finance_money_reads.employers). */
export interface EmployerSpelling {
  name: string;
  record_count: number;
  /** Distinct printed donor names; rows with no donor name are not counted. */
  donor_name_count: number;
  unnamed_records: number;
  /** Rows of this spelling an organization's confirmation covers. */
  confirmed_records: number;
}

export interface EmployerSpellings {
  state: 'reported' | 'not_reported' | 'unavailable';
  q?: string;
  rows: EmployerSpelling[];
  total: number | null;
  page: Paging;
  fetched_at: string | null;
}

export interface DonorPaymentRow extends ReceivedRow {
  recipient_is_filer?: boolean;
}

/** 1 donor group in `GET /finance/employers/donors`: a printed donor name, or 1
 * unnamed record on its own, with its first payments. */
export interface DonorGroup {
  key: string;
  name: string | null;
  record_number: number | null;
  payment_count: number;
  payments: DonorPaymentRow[];
}

export interface EmployerDonors {
  state: 'reported' | 'not_reported' | 'unavailable';
  name: string;
  rows: DonorGroup[];
  total: number | null;
  page: Paging;
  release_id: string | null;
  fetched_at: string | null;
}

interface DonorPayments {
  state: string;
  payments: DonorPaymentRow[];
  page: Paging;
}

function n(value: number, one: string, many: string): string {
  return `${formatCount(value)} ${value === 1 ? one : many}`;
}

/** "{n} donor names · Confirmed for {k} of {m} records" (Design Rounds 29 and 42). */
export function spellingMeta(row: EmployerSpelling): string {
  const names = n(row.donor_name_count, 'donor name', 'donor names');
  return row.confirmed_records > 0
    ? `${names} · Confirmed for ${formatCount(row.confirmed_records)} of ${formatCount(row.record_count)} records`
    : names;
}

export interface EmployerIdentity {
  id: string;
  kind: string;
  /** "Confirmed as {identity} for {k} of {n} records" (Design Round 42). */
  line: string;
}

export type Confirmation =
  | { state: 'confirmed'; identities: EmployerIdentity[] }
  | { state: 'unconfirmed' }
  | { state: 'loading' }
  | { state: 'unknown' };

/**
 * Every identity whose confirmations cover records printing exactly this employer
 * spelling, 1 line each with its own count over the spelling's held rows. A
 * similar spelling or a matching name never counts. Where the check could not be
 * read, the page says so rather than "no record confirms".
 */
export function employerConfirmation(
  records: IdentityRecords | null,
  unreadable: boolean,
): Confirmation {
  if (!records) return unreadable ? { state: 'unknown' } : { state: 'loading' };
  const identities = (records.identities ?? []).filter((identity) => identity.confirmed > 0);
  if (identities.length === 0) return { state: 'unconfirmed' };
  return {
    state: 'confirmed',
    identities: identities.map((identity) => ({
      id: identity.id,
      kind: identity.kind,
      line: `Confirmed as ${identity.name} for ${formatCount(identity.confirmed)} of ${formatCount(records.records)} records`,
    })),
  };
}

/** A payment's committee page: the tab of the donor's kind, the record's own filing
 * year (an unknown year stays unclaimed) and the donor's name (Design Round 32). */
export function paymentHref(payment: DonorPaymentRow, donor: string | null, here: string) {
  const registration = payment.recipient_registration_number;
  if (!registration || !payment.recipient_is_filer || !isBuilt('committee')) return null;
  return withFrom(
    hrefFor(
      'committee',
      { id: registration },
      {
        year: payment.year === null ? null : String(payment.year),
        tab: tabOfKind(payment.contributor_type),
        name: donor,
      },
    ),
    here,
  );
}

/** The donor's own payments page, all years. */
export function donorHref(donor: string | null, here: string): string | null {
  if (donor === null || !isBuilt('payments-under-name')) return null;
  return withFrom(hrefFor('payments-under-name', { query: donor }, { role: 'donor' }), here);
}

/**
 * Later pages of a paged list, added to the first page's rows. Reset whenever the
 * first page's address changes; a page from another release is refused, so 2
 * copies of the file never mix.
 */
function useMore<Row>(
  key: string | null,
  path: (offset: number) => string,
  rowsOf: (page: unknown) => Row[] | null,
) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const [extra, setExtra] = useState<{ key: string | null; rows: Row[]; hasMore: boolean | null }>({
    key,
    rows: [],
    hasMore: null,
  });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The pinned copy of the Board's file is no longer the published one (409).
  const [changed, setChanged] = useState(false);
  const reset = useCallback(() => {
    setExtra({ key, rows: [], hasMore: null });
    setFailed(false);
    setChanged(false);
    setLoading(false);
  }, [key]);
  useEffect(reset, [reset]);
  const own = extra.key === key ? extra : { key, rows: [] as Row[], hasMore: null };
  const more = useCallback(
    (offset: number) => {
      if (loading) return;
      setLoading(true);
      setFailed(false);
      let status = 0;
      const seen: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        status = response.status;
        return response;
      };
      void apiGet<{ page: Paging }>(apiBaseUrl, path(offset), accessToken, seen).then((answer) => {
        setLoading(false);
        if (status === 409) {
          setChanged(true);
          return;
        }
        const rows = answer.state === 'ok' ? rowsOf(answer.data) : null;
        if (answer.state !== 'ok' || rows === null) {
          setFailed(true);
          return;
        }
        setExtra((previous) =>
          previous.key === key
            ? { key, rows: [...previous.rows, ...rows], hasMore: answer.data.page.has_more }
            : previous,
        );
      });
    },
    // `path` and `rowsOf` are rebuilt each render; `key` carries their meaning.
    [apiBaseUrl, accessToken, key, loading],
  );
  return { rows: own.rows, hasMore: own.hasMore, loading, failed, changed, more, reset };
}

/** A later page was asked for against a Board file that has since changed (409). */
export const RELEASE_CHANGED = 'The Board’s file changed. Reload the records.';

/** The changed-file notice, with a reload that starts the donors over. */
function ChangedNotice({ onReload, reloading }: { onReload: () => void; reloading: boolean }) {
  return (
    <div role="alert" className="f-alert">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#c0392b" strokeWidth="2" />
        <path
          d="M12 7.5 V13 M12 16 V16.5"
          stroke="#c0392b"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <div>
        {RELEASE_CHANGED}
        <div className="f-alert-action">
          <button
            type="button"
            className="f-btn f-btn-secondary f-btn-small"
            aria-disabled={reloading || undefined}
            onClick={() => !reloading && onReload()}
          >
            {reloading && <span className="f-spinner" aria-hidden="true" />}
            Reload the records
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Donors by employer (Donors By Employer drawing, build notes Rounds 29, 30, 32 and
 * 42): employer spellings found by the server's paged directory (`/finance/employers`),
 * and for the chosen spelling the donors who printed it (`/finance/employers/donors`),
 * each donor's payments listed apart. No total is ever added across donors, and a
 * donor's payments are never the employer's money. The address holds the search
 * (`q`) and the chosen spelling (`/money/employers/:name`).
 */
export function DonorsByEmployer({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const from = location.searchParams.get('from');
  const back = returnTarget(location.search);
  const band = useBand();
  const single = band !== 'computer';
  const chosen = match.route.name === 'employer' ? (match.params.name ?? '') : '';
  const [address] = useAddressState({ q: '' });
  const q = address.q.trim();
  const searching = q.length >= MIN_SEARCH;

  const [draft, setDraft] = useState(q || chosen);
  // Back and Forward restore the earlier search into the field.
  useEffect(() => setDraft(q || chosen), [q, chosen]);

  const list = useRead<EmployerSpellings>(
    searching ? apiPath(['finance', 'employers'], { q, limit: SPELLINGS_PAGE }) : null,
    { keepPrevious: true },
  );
  const listKey = searching ? q : null;
  const moreSpellings = useMore<EmployerSpelling>(
    listKey,
    (offset) => apiPath(['finance', 'employers'], { q, limit: SPELLINGS_PAGE, offset }),
    (data) => (data as EmployerSpellings).rows ?? null,
  );
  const spellings = list.data ? [...list.data.rows, ...moreSpellings.rows] : [];
  const spellingsHasMore = moreSpellings.hasMore ?? list.data?.page.has_more ?? false;

  // On a computer the first spelling opens beside the list until another is chosen.
  const selected = chosen || (!single && searching ? (spellings[0]?.name ?? '') : '');
  const showList = searching && (!single || !chosen);
  const showDetail = selected !== '' && (!single || chosen !== '');

  function hrefOf(spelling: string) {
    return withFrom(hrefFor('employer', { name: spelling }, { q: q || null }), from);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    // A search the directory cannot answer (under 3 characters) opens that exact spelling.
    navigate(
      withFrom(
        next.length >= MIN_SEARCH
          ? hrefFor('employers', {}, { q: next })
          : hrefFor('employer', { name: next }),
        from,
      ),
    );
  }

  const listRow = spellings.find((row) => row.name === selected) ?? null;
  const copiedAt = list.data?.fetched_at ?? null;

  return (
    <main id="main" className="f-page de-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="de-header">
          <h1 tabIndex={-1} className="f-page-title">
            Donors by employer
          </h1>
          <p className="de-lead">
            Where people who name an employer give. Each spelling is its own entry, and each donor’s
            payments are their own, never the employer’s money.
          </p>
        </header>
        <form onSubmit={submit} className="de-form">
          <label className="pn-label">
            <span className="pn-label-text">Employer name as printed</span>
            <input
              type="text"
              className="f-field pn-field"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="f-btn pn-submit">
            Search
          </button>
        </form>

        {searching && list.loading && (
          <div role="status" aria-busy="true" className="pn-loading pn-narrow">
            <span className="f-spinner" aria-hidden="true" />
            Loading employer spellings…
          </div>
        )}
        {searching && list.updating && (
          <div className="pn-gap pn-narrow">
            <Updating />
          </div>
        )}
        {searching && list.failed && (
          <div className="pn-gap pn-narrow">
            <Refused onRetry={list.retry} retrying={list.pending}>
              {list.data ? 'We couldn’t load these employer spellings' : FAILED}
            </Refused>
          </div>
        )}
        {searching && list.data?.state === 'unavailable' && !chosen && (
          <div className="f-empty-box pn-gap pn-narrow">
            {RECORDS_UNAVAILABLE_TITLE}
            <div className="f-empty-next">{RECORDS_UNAVAILABLE_WHY}</div>
          </div>
        )}
        {searching && list.data?.state === 'not_reported' && !chosen && (
          <div className="f-empty-box pn-gap pn-narrow">
            No employer printed as “{list.data.q ?? q}” appears in the copied contribution records.
            This does not mean no donor works there.
          </div>
        )}

        {(showList && spellings.length > 0) || showDetail ? (
          <div
            className="de-layout"
            data-split={(showList && spellings.length > 0 && showDetail) || undefined}
          >
            {showList && spellings.length > 0 && (
              <section aria-labelledby="de-spellings-h" className="de-spellings">
                <div className="de-spellings-head">
                  <h2 id="de-spellings-h" className="de-spellings-title">
                    Employer spellings
                  </h2>
                  {list.data?.total != null && (
                    <span className="de-count f-num">
                      {n(list.data.total, 'spelling', 'spellings')}
                    </span>
                  )}
                </div>
                <ul className="de-spelling-list">
                  {spellings.map((row) => {
                    const current = showDetail && row.name === selected;
                    return (
                      <li key={row.name}>
                        <Link
                          to={hrefOf(row.name)}
                          className="de-spelling-item"
                          aria-current={current || undefined}
                        >
                          <span className="de-spelling-name">{row.name}</span>
                          <span className="de-spelling-meta f-num">{spellingMeta(row)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {spellingsHasMore && (
                  <div className="de-list-more">
                    {moreSpellings.failed ? (
                      <Refused
                        onRetry={() => moreSpellings.more(spellings.length)}
                        retrying={moreSpellings.loading}
                      >
                        We couldn’t load more employer spellings
                      </Refused>
                    ) : (
                      <button
                        type="button"
                        className="f-btn f-btn-secondary f-btn-small"
                        aria-disabled={moreSpellings.loading || undefined}
                        onClick={() => moreSpellings.more(spellings.length)}
                      >
                        {moreSpellings.loading && <span className="f-spinner" aria-hidden="true" />}
                        Show more
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            {showDetail && (
              <Detail
                key={selected}
                spelling={selected}
                listRow={listRow}
                backToList={
                  single && chosen && searching
                    ? withFrom(hrefFor('employers', {}, { q }), from)
                    : null
                }
                phone={band === 'phone'}
                here={here}
              />
            )}
          </div>
        ) : null}
      </div>
      <SourcesAndUpdates>
        <CopyLine fetchedAt={copiedAt} spelling={showDetail ? selected : null} />
        <a
          href={BOARD_FILES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="f-dest pn-source-link"
        >
          <span>
            <WithArrow>View the Board’s contribution files</WithArrow>
          </span>
          <span className="f-visually-hidden"> (opens in a new tab)</span>
        </a>
      </SourcesAndUpdates>
    </main>
  );
}

/** The contribution file's copy line, from the list or, without one, the donors' read
 * (the same cached answer the detail holds). */
function CopyLine({ fetchedAt, spelling }: { fetchedAt: string | null; spelling: string | null }) {
  const donors = useRead<EmployerDonors>(!fetchedAt && spelling ? donorsPath(spelling) : null);
  const at = fetchedAt ?? donors.data?.fetched_at ?? null;
  if (!at) return null;
  return (
    <p className="pn-source-line">
      Employer names and payments: {BOARD} contribution files, copied {centralDateLabel(at)}.
      Employer names are printed as each donor wrote them.
    </p>
  );
}

function donorsPath(spelling: string, offset = 0, releaseId: string | null = null) {
  return apiPath(['finance', 'employers', 'donors'], {
    name: spelling,
    limit: DONORS_PAGE,
    offset: offset || null,
    release_id: releaseId,
  });
}

function Detail({
  spelling,
  listRow,
  backToList,
  phone,
  here,
}: {
  spelling: string;
  listRow: EmployerSpelling | null;
  backToList: string | null;
  phone: boolean;
  here: string;
}) {
  const read = useRead<EmployerDonors>(donorsPath(spelling));
  const identity = useIdentityRecords('employer_name', spelling);
  const data = read.data;
  const release = data?.release_id ?? null;
  const moreDonors = useMore<DonorGroup>(
    data ? `${spelling}|${release}` : null,
    (offset) => donorsPath(spelling, offset, release),
    (page) => (page as EmployerDonors).rows ?? null,
  );
  // A later page of any donor's payments found the file changed; every donor's
  // added pages are dropped when the records reload.
  const [paymentsChanged, setPaymentsChanged] = useState(false);
  const [generation, setGeneration] = useState(0);
  function reload() {
    setPaymentsChanged(false);
    setGeneration((value) => value + 1);
    moreDonors.reset();
    read.retry();
  }
  const reveal = useRevealFocus<HTMLElement>();
  const donors = data ? [...data.rows, ...moreDonors.rows] : [];
  const donorsHasMore = moreDonors.hasMore ?? data?.page.has_more ?? false;
  const named = donors.filter((donor) => donor.name !== null).length;
  // The directory's count of printed donor names; without it, exact only once every
  // donor is loaded.
  const donorCount = listRow?.donor_name_count ?? (donorsHasMore ? null : named);
  const confirmation = employerConfirmation(identity.data, identity.failed || identity.notFound);

  return (
    <section aria-labelledby="de-employer-h" className="de-results" ref={reveal.list}>
      {backToList && (
        <Link to={backToList} className="f-back de-to-list">
          <Chevron />
          <span>Back to Employer spellings</span>
        </Link>
      )}
      <div className="de-card">
        <span className="f-label de-label">EMPLOYER AS PRINTED</span>
        <h2 id="de-employer-h" className="de-spelling">
          {spelling}
        </h2>
        <ConfirmationLine confirmation={confirmation} spelling={spelling} here={here} />
      </div>
      {read.loading && (
        <div role="status" aria-busy="true" className="pn-loading de-status">
          <span className="f-spinner" aria-hidden="true" />
          Loading…
        </div>
      )}
      {read.failed && !data && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          {FAILED}
        </Refused>
      )}
      {data?.state === 'not_reported' && (
        <div className="f-empty-box">
          No employer printed as “{spelling}” appears in the copied contribution records. This does
          not mean no donor works there.
        </div>
      )}
      {data?.state === 'unavailable' && (
        <div className="f-empty-box">
          {RECORDS_UNAVAILABLE_TITLE}
          <div className="f-empty-next">{RECORDS_UNAVAILABLE_WHY}</div>
        </div>
      )}
      {donors.length > 0 && (
        <>
          <div className="de-donors-head">
            <h3 className="de-donors-title">Donors who printed this employer</h3>
            <span className="de-count f-num">
              {donorCount === null
                ? `${n(named, 'donor name', 'donor names')} so far`
                : n(donorCount, 'donor name', 'donor names')}
            </span>
          </div>
          {donors.map((donor) => (
            <Donor
              key={donor.key}
              donor={donor}
              spelling={spelling}
              release={release}
              phone={phone}
              here={here}
              generation={generation}
              onChanged={() => setPaymentsChanged(true)}
            />
          ))}
          {(moreDonors.changed || paymentsChanged) && (
            <ChangedNotice onReload={reload} reloading={read.pending} />
          )}
          {donorsHasMore && !moreDonors.changed && !paymentsChanged && (
            <div className="pn-more">
              {moreDonors.failed && (
                <Refused
                  onRetry={() => moreDonors.more(donors.length)}
                  retrying={moreDonors.loading}
                >
                  We couldn’t load more donors
                </Refused>
              )}
              {!moreDonors.failed && (
                <button
                  type="button"
                  className="f-btn f-btn-secondary pn-more-btn"
                  aria-disabled={moreDonors.loading || undefined}
                  onClick={() => {
                    reveal.mark();
                    moreDonors.more(donors.length);
                  }}
                >
                  {moreDonors.loading && <span className="f-spinner" aria-hidden="true" />}
                  Show more
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Donor({
  donor,
  spelling,
  release,
  phone,
  here,
  generation,
  onChanged,
}: {
  donor: DonorGroup;
  spelling: string;
  release: string | null;
  phone: boolean;
  here: string;
  /** Bumped when the records reload, so added pages start over. */
  generation: number;
  onChanged: () => void;
}) {
  const more = useMore<DonorPaymentRow>(
    `${spelling}|${release}|${donor.key}|${generation}`,
    (offset) =>
      apiPath(['finance', 'employers', 'donor-payments'], {
        name: spelling,
        donor: donor.name,
        record_number: donor.name === null ? donor.record_number : null,
        limit: PAYMENTS_PAGE,
        offset,
        release_id: release,
      }),
    (page) => (page as DonorPayments).payments ?? null,
  );
  useEffect(() => {
    if (more.changed) onChanged();
    // `onChanged` is rebuilt each render; the change itself is what matters.
  }, [more.changed]);
  const reveal = useRevealFocus<HTMLElement>();
  const payments = [...donor.payments, ...more.rows];
  const hasMore = payments.length < donor.payment_count && more.hasMore !== false && !more.changed;
  const name = donor.name ?? UNNAMED_PAYMENT_PARTY;
  const href = donorHref(donor.name, here);
  return (
    <section aria-label={name} className="de-donor" ref={reveal.list}>
      <div className="de-donor-head">
        {href ? (
          <Link to={href} className="de-donor-name">
            {name}
          </Link>
        ) : (
          <span className="de-donor-name de-donor-plain">{name}</span>
        )}
        <span className="de-count f-num">{n(donor.payment_count, 'payment', 'payments')}</span>
      </div>
      <div role="table" aria-label={`Payments from ${name}`}>
        {!phone && (
          <div role="row" className="de-row de-head">
            <span role="columnheader">RECIPIENT</span>
            <span role="columnheader">EMPLOYER NAME AS PRINTED</span>
            <span role="columnheader">DATE</span>
            <span role="columnheader" className="de-amount">
              AMOUNT
            </span>
          </div>
        )}
        {payments.map((payment) => {
          const link = paymentHref(payment, donor.name, here);
          const date = formatDay(payment.received_on);
          const amount = formatMoney(payment.amount);
          const employer = payment.employer ?? spelling;
          return (
            <div role="row" key={payment.record_number} className="de-row">
              <span role="cell" className="de-recipient">
                {link ? (
                  <Link to={link} className="de-recipient-link">
                    {payment.recipient_name ?? UNNAMED_PAYMENT_PARTY}
                  </Link>
                ) : (
                  <span className="de-recipient-text">
                    {payment.recipient_name ?? UNNAMED_PAYMENT_PARTY}
                  </span>
                )}
              </span>
              <span role="cell" className="de-employer">
                {phone ? `Employer name as printed: ${employer}` : employer}
              </span>
              <span role="cell" className="de-date f-num" data-missing={date === null || undefined}>
                {date ?? 'Date not given'}
              </span>
              <span
                role="cell"
                className="de-amount f-num"
                data-missing={amount === null || undefined}
              >
                {amount ?? 'Amount not given'}
              </span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div className="pn-more de-donor-more">
          {more.failed ? (
            <Refused onRetry={() => more.more(payments.length)} retrying={more.loading}>
              We couldn’t load more payments
            </Refused>
          ) : (
            <button
              type="button"
              className="f-btn f-btn-secondary pn-more-btn"
              aria-disabled={more.loading || undefined}
              onClick={() => {
                reveal.mark();
                more.more(payments.length);
              }}
            >
              {more.loading && <span className="f-spinner" aria-hidden="true" />}
              {CAP_NEXT_LABEL}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ConfirmedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
      <path
        d="M8 12.5 L10.8 15.2 L16 9.5"
        stroke="#0E6A82"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A check that could not run, never the "not confirmed" mark: the answer is unknown. */
function CheckFailedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#5F6B76" strokeWidth="2" />
      <path d="M12 7.5 V13 M12 16 V16.5" stroke="#5F6B76" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function UnconfirmedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#5F6B76" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

function profileHref(identity: EmployerIdentity, here: string): string | null {
  if (identity.kind === 'organization' && isBuilt('organization')) {
    return withFrom(hrefFor('organization', { id: identity.id }), here);
  }
  if (identity.kind === 'person' && isBuilt('person')) {
    return withFrom(hrefFor('person', { id: identity.id }), here);
  }
  return null;
}

function ConfirmationLine({
  confirmation,
  spelling,
  here,
}: {
  confirmation: Confirmation;
  spelling: string;
  here: string;
}) {
  if (confirmation.state === 'confirmed') {
    return (
      <>
        {confirmation.identities.map((identity) => {
          const href = profileHref(identity, here);
          return (
            <div key={identity.id} className="de-confirm">
              <span className="de-confirm-text">
                <ConfirmedIcon />
                <span className="f-num">{identity.line}</span>
              </span>
              {href && (
                <Link to={href} className="f-dest de-confirm-link">
                  <span>
                    <WithArrow>Open profile</WithArrow>
                  </span>
                </Link>
              )}
            </div>
          );
        })}
      </>
    );
  }
  if (confirmation.state === 'unconfirmed') {
    return (
      <div className="de-confirm">
        <span className="de-confirm-text">
          <UnconfirmedIcon />
          <span>No organization record confirms this spelling</span>
        </span>
        {isBuilt('identities') && (
          <Link
            to={withFrom(hrefFor('identities', {}, { name: spelling, role: 'employer' }), here)}
            className="f-dest de-confirm-link"
          >
            <span>
              <WithArrow>Confirm this employer</WithArrow>
            </span>
          </Link>
        )}
      </div>
    );
  }
  if (confirmation.state === 'loading') return null;
  return (
    <div className="de-confirm">
      <span className="de-confirm-text">
        <CheckFailedIcon />
        <span>We couldn’t check whether an organization record confirms this spelling</span>
      </span>
    </div>
  );
}
