import { useEffect, useState, type FormEvent } from 'react';

import { UNNAMED_PAYMENT_PARTY } from '@alethical/shared/committeeMoneyShared';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import {
  CAP_NEXT_LABEL,
  CAP_NOTE,
  LOAD_MORE_ERROR,
  RECORDS_UNAVAILABLE_TITLE,
  RECORDS_UNAVAILABLE_WHY,
} from '@alethical/shared/paymentsUnderName';

import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useBand } from '../ui/band';
import { Refused, Updating } from '../ui/controls';
import { BackLink, SourcesAndUpdates, WithArrow } from '../ui/parts';
import { useRevealFocus } from '../ui/revealFocus';
import { tabOfKind } from './committee/data';
import {
  namePaymentsQuery,
  partialLine,
  useIdentityRecords,
  useNamePayments,
  type IdentityRecords,
  type ReceivedRow,
} from './payments/data';
import './payments.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const BOARD_FILES_URL =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';

export interface DonorPayment {
  key: string;
  recipient: string;
  /** Set only for a committee this release holds as a filer. */
  href: string | null;
  /** The employer exactly as this payment's donor printed it. */
  employer: string;
  date: string | null;
  amount: string | null;
}

export interface Donor {
  key: string;
  /** The donor's name exactly as printed; never joined to another spelling. */
  name: string;
  /** Payments under this name with the role donor, or null for an unnamed row. */
  href: string | null;
  payments: DonorPayment[];
}

function count(value: number, one: string, many: string, more: boolean): string {
  return `${formatCount(value)} ${value === 1 ? one : many}${more ? ' so far' : ''}`;
}

/**
 * The payments whose donors printed 1 employer spelling, grouped by each donor's
 * own printed name in the order the server serves them (newest first). Donors are
 * never merged by name and their payments are never added up: each payment stays
 * the donor's own, never the employer's money (build notes Rounds 19 and 20). A row
 * with no donor name is its own entry, since nothing establishes whose it is.
 */
export function groupDonors(
  payments: readonly ReceivedRow[],
  spelling: string,
  linkable: ReadonlySet<string>,
  here: string,
): Donor[] {
  const donors = new Map<string, Donor>();
  for (const payment of payments) {
    const key =
      payment.contributor === null
        ? `unnamed-${payment.record_number}`
        : `name|${payment.contributor}`;
    const donor = donors.get(key) ?? {
      key,
      name: payment.contributor ?? UNNAMED_PAYMENT_PARTY,
      href:
        payment.contributor !== null && isBuilt('payments-under-name')
          ? withFrom(
              hrefFor('payments-under-name', { query: payment.contributor }, { role: 'donor' }),
              here,
            )
          : null,
      payments: [],
    };
    const registration = payment.recipient_registration_number;
    donor.payments.push({
      key: String(payment.record_number),
      recipient: payment.recipient_name ?? UNNAMED_PAYMENT_PARTY,
      href:
        registration && linkable.has(registration) && isBuilt('committee')
          ? withFrom(
              hrefFor(
                'committee',
                { id: registration },
                {
                  year: payment.year === null ? null : String(payment.year),
                  tab: tabOfKind(payment.contributor_type),
                },
              ),
              here,
            )
          : null,
      employer: payment.employer ?? spelling,
      date: formatDay(payment.received_on),
      amount: formatMoney(payment.amount),
    });
    donors.set(key, donor);
  }
  return [...donors.values()];
}

export type Confirmation =
  | { state: 'confirmed'; identities: Array<{ id: string; name: string; partial: string | null }> }
  | { state: 'unconfirmed' }
  | { state: 'loading' }
  | { state: 'unknown' };

/**
 * Whether an organization record confirms this exact spelling: only identities of
 * kind organization whose confirmations cover records printing it. A person's
 * confirmation, a similar spelling or a matching name never counts. Where the
 * check could not be read, the page says so rather than "no record confirms".
 */
export function employerConfirmation(
  records: IdentityRecords | null,
  unreadable: boolean,
): Confirmation {
  if (!records) return unreadable ? { state: 'unknown' } : { state: 'loading' };
  const organizations = (records.identities ?? []).filter(
    (identity) => identity.kind === 'organization' && identity.confirmed > 0,
  );
  if (organizations.length === 0) return { state: 'unconfirmed' };
  return {
    state: 'confirmed',
    identities: organizations.map((identity) => ({
      id: identity.id,
      name: identity.name,
      partial: partialLine(identity, records.records),
    })),
  };
}

/**
 * Donors by employer, as printed (Donors By Employer drawing, build notes Rounds 19
 * and 20). `/money/employers` holds the search box; `/money/employers/:name` shows
 * the donors who printed exactly that employer spelling, each with their own
 * payments, read from `/campaign-finance/payments-under-name?role=employer`.
 *
 * The drawing's "Employer spellings" list needs a server search over the employer
 * column, which the shared API deliberately does not serve (its money search has no
 * employer group), so each typed spelling opens on its own.
 */
export function DonorsByEmployer({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const from = location.searchParams.get('from');
  const back = returnTarget(location.search);
  const band = useBand();
  const spelling = match.route.name === 'employer' ? (match.params.name ?? '') : '';

  const [draft, setDraft] = useState(spelling);
  // Back and Forward restore the earlier spelling into the field.
  useEffect(() => setDraft(spelling), [spelling]);

  const reveal = useRevealFocus<HTMLElement>();
  const read = useNamePayments<ReceivedRow>(
    spelling ? namePaymentsQuery(spelling, 'employer', null) : null,
  );
  const identity = useIdentityRecords('employer_name', spelling || null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    navigate(withFrom(hrefFor('employer', { name: next }), from));
  }

  const data = read.data;
  const shownSpelling = data?.name ?? spelling;
  const empty = data !== null && data.state === 'not_reported';
  const unavailable = data !== null && data.state === 'unavailable';
  const donors =
    data && data.state === 'reported'
      ? groupDonors(data.payments, shownSpelling, data.linkable, here)
      : [];
  const more = data?.hasMore ?? false;
  // The confirmation is read for the address's spelling; while the donors shown
  // still belong to an earlier spelling, no confirmation is paired with them.
  const confirmation: Confirmation =
    shownSpelling === spelling
      ? employerConfirmation(identity.data, identity.failed || identity.notFound)
      : { state: 'loading' };
  const copied = data?.fetchedAt ? centralDateLabel(data.fetchedAt) : null;

  return (
    <main id="main" className="f-page de-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="de-header">
          <h1 tabIndex={-1} className="f-page-title">
            Donors by employer, as printed
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

        {read.updating && (
          <div className="pn-gap pn-narrow">
            <Updating />
          </div>
        )}
        {read.loading && (
          <div role="status" aria-busy="true" className="pn-loading pn-narrow">
            <span className="f-spinner" aria-hidden="true" />
            Loading…
          </div>
        )}
        {read.failed && !data && (
          <div className="pn-gap pn-narrow">
            <Refused onRetry={read.retry} retrying={read.pending}>
              We couldn’t load these donors. This is a problem on our side and says nothing about
              what was filed under this employer.
            </Refused>
          </div>
        )}
        {empty && (
          <div className="f-empty-box pn-gap pn-narrow">
            No employer printed as “{shownSpelling}” appears in the copied contribution records.
            This does not mean no donor works there.
          </div>
        )}
        {unavailable && (
          <div className="f-empty-box pn-gap pn-narrow">
            {RECORDS_UNAVAILABLE_TITLE}
            <div className="f-empty-next">{RECORDS_UNAVAILABLE_WHY}</div>
          </div>
        )}

        {donors.length > 0 && (
          <section aria-labelledby="de-employer-h" className="de-results" ref={reveal.list}>
            <div className="de-card">
              <span className="f-label de-label">EMPLOYER AS PRINTED</span>
              <h2 id="de-employer-h" className="de-spelling">
                {shownSpelling}
              </h2>
              <ConfirmationLine confirmation={confirmation} spelling={shownSpelling} here={here} />
            </div>
            <div className="de-donors-head">
              <h3 className="de-donors-title">Donors who printed this employer</h3>
              <span className="de-count f-num">
                {count(donors.length, 'donor name', 'donor names', more)}
              </span>
            </div>
            {donors.map((donor) => (
              <section key={donor.key} aria-label={donor.name} className="de-donor">
                <div className="de-donor-head">
                  {donor.href ? (
                    <Link to={donor.href} className="de-donor-name">
                      {donor.name}
                    </Link>
                  ) : (
                    <span className="de-donor-name de-donor-plain">{donor.name}</span>
                  )}
                  <span className="de-count f-num">
                    {count(donor.payments.length, 'payment', 'payments', more)}
                  </span>
                </div>
                <div role="table" aria-label={`Payments from ${donor.name}`}>
                  {band !== 'phone' && (
                    <div role="row" className="de-row de-head">
                      <span role="columnheader">RECIPIENT</span>
                      <span role="columnheader">EMPLOYER NAME AS PRINTED</span>
                      <span role="columnheader">DATE</span>
                      <span role="columnheader" className="de-amount">
                        AMOUNT
                      </span>
                    </div>
                  )}
                  {donor.payments.map((payment) => (
                    <div role="row" key={payment.key} className="de-row">
                      <span role="cell" className="de-recipient">
                        {payment.href ? (
                          <Link to={payment.href} className="de-recipient-link">
                            {payment.recipient}
                          </Link>
                        ) : (
                          <span className="de-recipient-text">{payment.recipient}</span>
                        )}
                      </span>
                      <span role="cell" className="de-employer">
                        {band === 'phone'
                          ? `Employer name as printed: ${payment.employer}`
                          : payment.employer}
                      </span>
                      <span
                        role="cell"
                        className="de-date f-num"
                        data-missing={payment.date === null || undefined}
                      >
                        {payment.date ?? 'Date not given'}
                      </span>
                      <span
                        role="cell"
                        className="de-amount f-num"
                        data-missing={payment.amount === null || undefined}
                      >
                        {payment.amount ?? 'Amount not given'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {more && (
              <div className="pn-more">
                <p className="pn-more-note">{CAP_NOTE}</p>
                {read.moreFailed && <p className="pn-more-error">{LOAD_MORE_ERROR}</p>}
                <button
                  type="button"
                  className="f-btn f-btn-secondary pn-more-btn"
                  aria-disabled={read.loadingMore || undefined}
                  onClick={() => {
                    if (read.loadingMore) return;
                    reveal.mark();
                    read.more();
                  }}
                >
                  {read.loadingMore && <span className="f-spinner" aria-hidden="true" />}
                  {CAP_NEXT_LABEL}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      <SourcesAndUpdates>
        {copied && (
          <p className="pn-source-line">
            Employer names and payments: {BOARD} contribution files, copied {copied}. Employer names
            are printed as each donor wrote them.
          </p>
        )}
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
        {confirmation.identities.map((identity) => (
          <div key={identity.id} className="de-confirm">
            <span className="de-confirm-text">
              <ConfirmedIcon />
              <span className="de-confirm-words">
                <span>The {identity.name} organization record confirms this spelling</span>
                {identity.partial && <span className="f-num">{identity.partial}</span>}
              </span>
            </span>
            {isBuilt('organization') && (
              <Link
                to={withFrom(hrefFor('organization', { id: identity.id }), here)}
                className="f-dest de-confirm-link"
              >
                <span>
                  <WithArrow>Open profile</WithArrow>
                </span>
              </Link>
            )}
          </div>
        ))}
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
            to={withFrom(hrefFor('identities', {}, { name: spelling }), here)}
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
