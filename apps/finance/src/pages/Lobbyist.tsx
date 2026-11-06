import { useCallback, useEffect, useRef, useState } from 'react';

import { boardRecordUrl } from '@alethical/shared/boardRecordLink';
import { registerKindFromEntityType } from '@alethical/shared/committeeMoneyShared';
import {
  LOBBYIST_SOURCE_URL,
  lobbyingLobbyistCopy as COPY,
  lobbyingRevealLabel,
  LOBBYING_NO_SPENDING_PAGE,
  LOBBYING_RECORD_LOADING,
  LOBBYING_RECORD_REVEAL_STEP,
  recordCountLine,
} from '@alethical/shared/lobbyingRecordCopy';
import type {
  LobbyingContributionCommittee,
  LobbyingContributionPayment,
  LobbyingContributionYear,
  LobbyingLobbyist,
} from '@alethical/shared/lobbyingTypes';
import { formatDay, formatMoney } from '../ui/money';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { contributionRecordReview } from '@alethical/shared/moneyRecordTrust';
import { PAYMENT_FILE_LABELS } from '@alethical/shared/paymentCopyDates';

import { apiPath, useRead } from '../api/read';
import { sumAmounts } from './committee/data';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { EvidencePanel, Refused, type Evidence } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates } from '../ui/parts';
import { useRevealFocus } from '../ui/revealFocus';
import {
  IdentityBox,
  notFoundLine,
  OfficialLink,
  RecordRow,
  recordNumber,
  useConfirmedIdentity,
} from './lobbying/parts';
import './lobbying.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const CONTRIBUTION_FILE_PAGE =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
const FAILED =
  'We couldn’t load the Board’s lobbying record. This says nothing about what was reported.';
const ORGS_HEADING = 'Organizations represented';
const ORGS_SCOPE =
  'The lobbyist list shows which organizations this lobbyist represented on the copy date';
const ORGS_NOTE = 'It does not show past clients';
const NO_ORGS = 'The lobbyist list names no organization for this lobbyist on the copy date';
const GAVE_SCOPE = 'Campaign contributions, separate from lobbying spending';
const GAVE_NOTE =
  'Years follow the state file’s filing year. A payment date can fall in a different calendar year. Records are matched using registration numbers in the contribution file or confirmed in official reports; a name alone is not enough. The count is of matching records, not a confirmed count of separate donations. These records may not capture all giving.';
const TOTAL_MISSING = 'Missing payment amount';
const PERIOD_INCOMPLETE = 'Reporting period incomplete';

/**
 * A committee's matched records in 1 filing year, added up under the shared rule
 * (Rounds 36 and 41): every amount held, and the filing year or every date held.
 * A missing amount withholds the sum first; a refund keeps its sign.
 */
export function committeeTotal(
  committee: LobbyingContributionCommittee,
  year: number | null,
): string {
  const payments = committee.payments;
  if (payments.length !== committee.payment_count) return TOTAL_MISSING;
  const sum = sumAmounts(payments.map((payment) => payment.amount));
  if (sum === null) return TOTAL_MISSING;
  if (year === null && payments.some((payment) => !payment.received_on)) {
    return PERIOD_INCOMPLETE;
  }
  return formatMoney(sum) ?? TOTAL_MISSING;
}

/** How many payment rows to show first so the asked-for year's records are on
 * screen: every row of the years before it, then 1 reveal step of its own. */
export function firstShown(years: readonly LobbyingContributionYear[], year: string): number {
  const at = years.findIndex((item) => String(item.year) === year);
  if (at <= 0) return LOBBYING_RECORD_REVEAL_STEP;
  const before = years.slice(0, at).reduce((sum, item) => sum + item.payment_count, 0);
  return before + LOBBYING_RECORD_REVEAL_STEP;
}

/** This page's own address at its contributions, for the year of a record: the
 * return a committee page's "Back to Lobbyist" opens (Round 32). */
export function contributionsReturn(pathname: string, search: string, year: number | null) {
  const params = new URLSearchParams(search);
  if (year === null) params.delete('year');
  else params.set('year', String(year));
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}#contributions`;
}
const DONATIONS_FAILED =
  'We couldn’t load the state’s campaign contribution file. This does not mean no donation was filed under this registration number.';
const DATE_MISSING = 'Date not given in the public file';
const AMOUNT_MISSING = 'Amount not given';
const NAME_MISSING = 'Committee name not reported';

const records = (count: number) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'payment record' : 'payment records'}`;
const committees = (count: number) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'committee' : 'committees'}`;

/** The header's status: whether the registration is on the copied lobbyist list. */
export function registrationStatus(state: LobbyingLobbyist['state']): string {
  return state === 'reported' ? 'Registered on the copy date' : 'Not listed on the copy date';
}

/** A payment's kind: donated goods or services are marked, with their description. */
export function paymentKind(payment: LobbyingContributionPayment): string {
  if (payment.in_kind === 'Yes') {
    const what = payment.in_kind_description?.trim();
    return what ? `Donated goods or services · ${what}` : 'Donated goods or services';
  }
  return 'Contribution';
}

/**
 * The years, committees and payments to draw when `limit` payment rows are shown,
 * in the served order. Each year and committee keeps its own whole counts; only the
 * payment rows are cut.
 */
export function revealed(
  years: readonly LobbyingContributionYear[],
  limit: number,
): Array<{ year: LobbyingContributionYear; committees: Array<LobbyingContributionCommittee> }> {
  let remaining = limit;
  const shown = [];
  for (const year of years) {
    if (remaining <= 0) break;
    const groups = [];
    for (const committee of year.committees) {
      if (remaining <= 0) break;
      const payments = committee.payments.slice(0, remaining);
      if (payments.length === 0) continue;
      remaining -= payments.length;
      groups.push({ ...committee, payments });
    }
    if (groups.length > 0) shown.push({ year, committees: groups });
  }
  return shown;
}

function evidenceFor(
  payer: string,
  committee: LobbyingContributionCommittee,
  year: number | null,
  copiedAt: string | null,
): Evidence {
  const kind = committee.kind ?? registerKindFromEntityType(committee.recipient_type);
  return {
    title: `${payer} to ${committee.name ?? NAME_MISSING}`,
    authority: BOARD,
    rows: [
      { label: 'Saved source', value: PAYMENT_FILE_LABELS.contributions },
      ...(copiedAt
        ? [{ label: 'Source version', value: `Copy of ${centralDateLabel(copiedAt)}` }]
        : []),
    ],
    quote: 'No saved source excerpt is held for this record',
    quoteLabel: 'SOURCE TEXT',
    checked: 'Not checked',
    ...(committee.registration_number && year !== null
      ? {
          sourceHref: boardRecordUrl(kind, committee.registration_number, year),
          sourceLabel: 'View source',
        }
      : {}),
  };
}

function ConfirmedMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function Donations({
  record,
  pathname,
  search,
  year: askedYear,
  onRetry,
  retrying,
}: {
  record: LobbyingLobbyist;
  pathname: string;
  search: string;
  /** The year the reader arrived for, from the address. */
  year: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const contributions = record.contributions;
  const [shown, setShown] = useState(() => firstShown(contributions.years, askedYear));
  const reveal = useRevealFocus<HTMLDivElement>();
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const closeEvidence = useCallback(() => setEvidence(null), []);
  useEffect(
    () => setShown(firstShown(contributions.years, askedYear)),
    [record.registration_number, contributions.release_id, askedYear, contributions.years],
  );

  const total = contributions.payment_count ?? 0;
  const failed = contributions.state === 'unavailable' || contributions.payment_count === null;
  const has = !failed && contributions.state === 'reported' && total > 0;
  const visible = has ? revealed(contributions.years, shown) : [];
  const visibleCount = Math.min(shown, total);
  const review = contributionRecordReview(record.registration_number, contributions.release_id);
  const registered = record.name?.trim() || null;

  return (
    <section id="contributions" aria-labelledby="lbl-gave" className="lbl-section">
      <h2 id="lbl-gave" tabIndex={-1} className="f-section-title lbl-gave">
        {COPY.donationsHeading}
      </h2>
      <p className="f-scope">{GAVE_SCOPE}</p>
      {failed && (
        <div className="lbl-box">
          <Refused onRetry={onRetry} retrying={retrying}>
            {DONATIONS_FAILED}
          </Refused>
        </div>
      )}
      {!failed && !has && <div className="f-empty-box lbl-box">{COPY.noDonations}</div>}
      {has && (
        <>
          <div className="lbl-count f-num">
            {recordCountLine(total, visibleCount, 'matching record', 'matching records')}
          </div>
          {review && (
            <div className="lbl-review" role="note">
              <strong>{review.title}</strong>
              <p>{review.body}</p>
            </div>
          )}
          <div className="lbl-years" ref={reveal.list}>
            {visible.map(({ year, committees: groups }, yearIndex) => {
              const label = year.year != null ? String(year.year) : 'Filing year not reported';
              return (
                <section
                  key={year.year ?? `none-${yearIndex}`}
                  id={year.year != null ? `yr-${year.year}` : undefined}
                  aria-label={label}
                  className="lbl-year"
                >
                  <div className="lbl-year-head">
                    <span className="lbl-year-label f-num">{label}</span>
                    <span className="lbl-year-sum f-num">
                      {committees(year.committee_count)} · {records(year.payment_count)}
                    </span>
                  </div>
                  {groups.map((committee, index) => {
                    const name = committee.name ?? NAME_MISSING;
                    const whole = year.committees.find(
                      (item) =>
                        item.registration_number === committee.registration_number &&
                        item.name === committee.name,
                    );
                    const total = committeeTotal(whole ?? committee, year.year);
                    const printed = committee.payments[0]?.contributor_name?.trim() || null;
                    const href =
                      committee.linkable &&
                      committee.registration_number &&
                      committee.name &&
                      isBuilt('committee')
                        ? withFrom(
                            hrefFor(
                              'committee',
                              { id: committee.registration_number },
                              {
                                year: year.year != null ? String(year.year) : null,
                                tab: 'lobbyists',
                                name: printed,
                              },
                            ),
                            contributionsReturn(pathname, search, year.year),
                          )
                        : null;
                    return (
                      <div
                        key={`${committee.registration_number ?? 'none'}-${index}`}
                        className="lbl-committee"
                      >
                        <div className="lbl-committee-head">
                          {/* The dot ends the name's line, so a wrapped count never
                              starts with it. */}
                          <span>
                            {href ? (
                              <Link to={href} className="lbl-committee-name">
                                {name}
                              </Link>
                            ) : (
                              <span className="lbl-committee-name">{name}</span>
                            )}
                            {'\u00a0·'}
                          </span>
                          <span className="lbl-committee-count f-num">
                            {records(committee.payment_count)}
                          </span>
                          <span
                            className="lbl-committee-total f-num"
                            data-missing={
                              total === TOTAL_MISSING || total === PERIOD_INCOMPLETE || undefined
                            }
                          >
                            {total}
                          </span>
                        </div>
                        {committee.payments.map((payment) => {
                          const filed = payment.contributor_name?.trim() || null;
                          const amount = formatMoney(payment.amount);
                          const payer =
                            filed ??
                            registered ??
                            `Registration number ${record.registration_number}`;
                          return (
                            <div key={payment.record_number} className="lbl-pay">
                              <span className="lbl-pay-date f-num">
                                {formatDay(payment.received_on) ?? DATE_MISSING}
                              </span>
                              <span className="lbl-pay-kind">
                                <span className="lbl-pay-type">{paymentKind(payment)}</span>
                                {filed && registered && filed !== registered && (
                                  <span className="lbl-pay-note">Filed as {filed}</span>
                                )}
                                {payment.identity_basis === 'official_report' && (
                                  <span className="lbl-pay-note lbl-confirmed">
                                    <ConfirmedMark />
                                    {COPY.reportIdentityNote}
                                  </span>
                                )}
                              </span>
                              <span
                                className="lbl-pay-amount f-num"
                                data-missing={amount === null || undefined}
                              >
                                {amount ?? AMOUNT_MISSING}
                              </span>
                              <button
                                type="button"
                                className="lbl-view"
                                onClick={() =>
                                  setEvidence(
                                    evidenceFor(
                                      payer,
                                      committee,
                                      year.year,
                                      contributions.copied_at,
                                    ),
                                  )
                                }
                              >
                                View source
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          {visibleCount < total && (
            <div className="lbl-more">
              <button
                type="button"
                className="f-btn f-btn-secondary lbl-more-btn"
                onClick={() => {
                  reveal.mark();
                  setShown((value) => value + LOBBYING_RECORD_REVEAL_STEP);
                }}
              >
                {lobbyingRevealLabel(total - visibleCount, 'payment record', 'payment records')}
              </button>
            </div>
          )}
          <p className="lb-note lbl-end-note">{GAVE_NOTE}</p>
        </>
      )}
      <EvidencePanel evidence={evidence} onClose={closeEvidence} />
    </section>
  );
}

/**
 * Lobbyist (Lobbyist drawing): 1 registration on the Board's copied lobbyist list,
 * the organizations it represented on the copy date, and campaign contribution
 * records matched to its registration number or confirmed in an official report.
 * Keyed on the registration number. Amounts are never added up here.
 */
export function Lobbyist({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  // With no usable earlier page, the drawn named fallback (contextual page-return rule).
  const back = returnTarget(location.search) ?? { to: hrefFor('lobbying'), name: 'Lobbying' };
  const reg = recordNumber(match.params.id);
  const askedYear = location.searchParams.get('year') ?? '';
  const read = useRead<LobbyingLobbyist>(reg ? apiPath(['lobbying', 'lobbyists', reg]) : null);
  const record = read.data && read.data.registration_number === reg ? read.data : null;
  // A number on no copied list and in no contribution record is a record we do not have.
  const missing =
    !reg ||
    read.notFound ||
    (record?.state === 'not_registered_today' && record.contributions.state === 'not_reported');
  const unavailable = !missing && record?.state === 'unavailable';
  const shown = !missing && !unavailable ? record : null;
  const identity = useConfirmedIdentity('lobbyist', shown ? reg : null);

  const name = shown
    ? (shown.name ?? shown.formatted_name ?? `Registration number ${shown.registration_number}`)
    : '';
  const orgs = shown?.principals.rows ?? [];
  // 5 at a time with "Show more", the approved reveal for a lobbyist's clients.
  const [orgsShown, setOrgsShown] = useState(LOBBYING_RECORD_REVEAL_STEP);
  useEffect(() => setOrgsShown(LOBBYING_RECORD_REVEAL_STEP), [reg]);
  const visibleOrgs = orgs.slice(0, orgsShown);
  const orgsReveal = useRevealFocus<HTMLUListElement>();
  // Arriving for a year's records (#contributions, from the directory or a
  // committee's "Back to Lobbyist"): bring that year into view and put focus on the
  // section heading. It waits a task so the page's own arrival scroll runs first.
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || window.location.hash !== '#contributions') return;
    const key = `${reg}|${askedYear}`;
    if (arrived.current === key) return;
    arrived.current = key;
    const timer = window.setTimeout(() => {
      const target =
        document.getElementById(`yr-${askedYear}`) ?? document.getElementById('contributions');
      if (target) {
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: Math.max(0, top) });
      }
      document.getElementById('lbl-gave')?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [shown, reg, askedYear]);

  const contributionsCopied =
    shown &&
    shown.contributions.state === 'reported' &&
    (shown.contributions.payment_count ?? 0) > 0
      ? shown.contributions.copied_at
      : null;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {read.loading && !missing && <LoadingLine>{LOBBYING_RECORD_LOADING}</LoadingLine>}
        {missing && (
          <div className="lb-state">
            {/* The page's heading, so focus and heading navigation land on it. */}
            <h1 tabIndex={-1} className="f-page-title lb-gone-title">
              {notFoundLine(match.params.id)}
            </h1>
          </div>
        )}
        {(unavailable || (read.failed && !record)) && !missing && (
          <div className="lb-state">
            <Refused onRetry={read.retry} retrying={read.pending}>
              {FAILED}
            </Refused>
          </div>
        )}
        {shown && (
          <>
            <header className="lb-header">
              <div className="lb-tags">
                <span className="lb-chip">LOBBYIST</span>
                <span className="lb-reg f-num">
                  Registration number {shown.registration_number}
                  {'\u00a0·'}
                </span>
                <span className="lb-status">{registrationStatus(shown.state)}</span>
              </div>
              <h1 tabIndex={-1} className="f-page-title lb-title">
                {name}
              </h1>
            </header>
            {identity && <IdentityBox identity={identity} from={here} />}

            <div className="lb-main">
              <section aria-labelledby="lbl-orgs" className="lbl-section">
                <h2 id="lbl-orgs" className="f-section-title">
                  {ORGS_HEADING}
                </h2>
                <p className="f-scope">{ORGS_SCOPE}</p>
                {orgs.length === 0 ? (
                  <div className="f-empty-box lbl-box">{NO_ORGS}</div>
                ) : (
                  <ul className="lb-list" ref={orgsReveal.list}>
                    {visibleOrgs.map((row) => {
                      const shownName = row.spending_name ?? row.name;
                      const note = [
                        `State entity ID ${row.entity_id}`,
                        row.spending_name && row.spending_name !== row.name
                          ? `registered as ${row.name} in the lobbyist list`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      const href =
                        row.linkable && isBuilt('principal')
                          ? withFrom(hrefFor('principal', { id: String(row.entity_id) }), here)
                          : null;
                      return (
                        <li key={`${row.entity_id}-${row.position}`}>
                          <RecordRow
                            name={shownName}
                            note={note}
                            href={href}
                            end={row.linkable ? undefined : LOBBYING_NO_SPENDING_PAGE}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
                {orgs.length > visibleOrgs.length && (
                  <div className="lbl-more">
                    <button
                      type="button"
                      className="f-btn f-btn-secondary lbl-more-btn"
                      onClick={() => {
                        orgsReveal.mark();
                        setOrgsShown((value) => value + LOBBYING_RECORD_REVEAL_STEP);
                      }}
                    >
                      {lobbyingRevealLabel(orgs.length - visibleOrgs.length, 'client', 'clients')}
                    </button>
                  </div>
                )}
                {orgs.length > 0 && <p className="lb-note lb-note-flush">{ORGS_NOTE}</p>}
              </section>
              <Donations
                record={shown}
                pathname={location.pathname}
                search={location.search}
                year={askedYear}
                onRetry={read.retry}
                retrying={read.pending}
              />
            </div>
          </>
        )}
      </div>
      {shown && (
        <SourcesAndUpdates>
          <p className="f-sources-line">
            Matching uses the lobbyist’s registration number in the contribution file or an official
            report. A missing number is confirmed only when the report’s registration number, donor
            name, payment date and amount establish a unique match. A name alone is not enough.
            Contributions reported without donor names cannot be matched. No matching records does
            not mean no giving.
          </p>
          <div className="lb-sources-links">
            <OfficialLink href={LOBBYIST_SOURCE_URL}>
              View the Board’s Lobbyist Search Tool
            </OfficialLink>
            <OfficialLink href={CONTRIBUTION_FILE_PAGE}>
              View the Board’s campaign contribution file
            </OfficialLink>
          </div>
          {shown.copied_at && (
            <p className="f-sources-line f-num">
              Lobbyist registration list copied {centralDateLabel(shown.copied_at)}
            </p>
          )}
          {contributionsCopied && (
            <p className="f-sources-line f-num">
              Campaign contribution file copied {centralDateLabel(contributionsCopied)}
            </p>
          )}
        </SourcesAndUpdates>
      )}
    </main>
  );
}
